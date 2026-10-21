import type { IPosition } from "../core/iPosition.ts";
import { comparePositions } from "../core/iPosition.ts";
import { createRange } from "../core/iRange.ts";
import type { ISelection } from "../core/iSelection.ts";
import { createCursorSelection, createSelection, isSelectionCollapsed, selectionToRange } from "../core/iSelection.ts";
import type { ITextEdit } from "../core/iTextEdit.ts";
import { createDeleteEdit, createInsertEdit, createTextEdit } from "../core/iTextEdit.ts";
import type { ITextDocument } from "../model/iTextDocument.ts";

/** Input `selections` is the view state's normalized list: document order, no overlaps. */
export type ILineOperationsDocument = Pick<
    ITextDocument,
    "lineCount" | "getLineContent" | "getLineLength" | "getTextInRange"
>;

export interface ILineOperationResult {
    edits: ITextEdit[];
    afterSelections: ISelection[];
}

/** An end at column 0 of the next line doesn't include that line (upstream semantics). */
function selectionLineBlock(sel: ISelection): { startLine: number; endLine: number } {
    const range = selectionToRange(sel);
    let endLine = range.end.line;
    if (endLine > range.start.line && range.end.character === 0) {
        endLine--;
    }
    return { startLine: range.start.line, endLine };
}

function blockText(doc: ILineOperationsDocument, block: { startLine: number; endLine: number }): string {
    const lines: string[] = [];
    for (let line = block.startLine; line <= block.endLine; line++) {
        lines.push(doc.getLineContent(line));
    }
    return lines.join("\n");
}

/**
 * Up keeps the selection on the upper copy, Down on the lower one. Blocks sharing a line don't
 * duplicate it twice: the upper block does it (upstream semantics).
 */
export function computeCopyLines(
    doc: ILineOperationsDocument,
    selections: readonly ISelection[],
    down: boolean,
): ILineOperationResult {
    const blocks = selections.map(selectionLineBlock);

    const kept: boolean[] = [];
    let prevKept: { startLine: number; endLine: number } | null = null;
    for (const block of blocks) {
        if (prevKept !== null && prevKept.endLine >= block.startLine) {
            kept.push(false);
        } else {
            kept.push(true);
            prevKept = block;
        }
    }

    const edits: ITextEdit[] = [];
    // Stryker disable next-line EqualityOperator: the extra iteration reads kept[length] === undefined and hits continue
    for (let i = 0; i < blocks.length; i++) {
        if (!kept[i]) continue;
        const text = blockText(doc, blocks[i]);
        if (down) {
            // Copy ABOVE the block: the original moves down, the selection stays with it.
            edits.push(createInsertEdit(blocks[i].startLine, 0, text + "\n"));
        } else {
            // Copy BELOW the block: the selection stays on the upper original.
            edits.push(createInsertEdit(blocks[i].endLine, doc.getLineLength(blocks[i].endLine), "\n" + text));
        }
    }

    const shiftLine = (line: number): number => {
        let delta = 0;
        // Stryker disable next-line EqualityOperator: the extra iteration reads kept[length] === undefined and hits continue
        for (let j = 0; j < blocks.length; j++) {
            if (!kept[j]) continue;
            const size = blocks[j].endLine - blocks[j].startLine + 1;
            // A down insert sits AT THE START of the block and moves the block itself; an up insert
            // sits at the end of its last line and moves only the lines below.
            if (down ? line >= blocks[j].startLine : line > blocks[j].endLine) {
                delta += size;
            }
        }
        return line + delta;
    };

    const afterSelections = selections.map((sel) =>
        createSelection(
            shiftLine(sel.anchor.line),
            sel.anchor.character,
            shiftLine(sel.active.line),
            sel.active.character,
        ),
    );

    return { edits, afterSelections };
}

/** Unlike {@link computeCopyLines}, cursors on the same line are not merged: each inserts its own copy. */
export function computeDuplicateSelection(
    doc: ILineOperationsDocument,
    selections: readonly ISelection[],
): ILineOperationResult {
    const plans = selections.map((sel) => {
        const collapsed = isSelectionCollapsed(sel);
        const range = selectionToRange(sel);
        return {
            collapsed,
            insertAt: collapsed ? { line: range.start.line, character: 0 } : range.end,
            text: collapsed ? doc.getLineContent(range.start.line) + "\n" : doc.getTextInRange(range),
            active: sel.active,
        };
    });

    // Positions are carried by REPLAYING the inserts together with the insert points: a cursor's edit
    // lands at line start, LEFT of a selection's edit on the same line, which cumulative deltas
    // can't express. Replay order doesn't matter: the shifts commute.
    const insertPoints = plans.map((plan) => plan.insertAt);
    const carets = plans.map((plan) => plan.active);
    for (let i = 0; i < plans.length; i++) {
        const at = insertPoints[i];
        const text = plans[i].text;
        for (let k = 0; k < plans.length; k++) {
            if (k !== i) insertPoints[k] = shiftThroughInsert(insertPoints[k], at, text);
            carets[k] = shiftThroughInsert(carets[k], at, text);
        }
    }

    const edits = plans.map((plan) => createInsertEdit(plan.insertAt.line, plan.insertAt.character, plan.text));
    const afterSelections = plans.map((plan, i) => {
        if (plan.collapsed) return createCursorSelection(carets[i].line, carets[i].character);
        const start = insertPoints[i];
        const end = shiftThroughInsert(start, start, plan.text);
        return createSelection(start.line, start.character, end.line, end.character);
    });

    return { edits, afterSelections };
}

/**
 * A multi-line insert changes only the line number, not the column. That holds only thanks to the
 * duplication invariant (the copy ends with what stands left of `at`), so the function lives
 * here and not in `core/`.
 */
function shiftThroughInsert(pos: IPosition, at: IPosition, text: string): IPosition {
    if (comparePositions(pos, at) < 0) return pos;
    const lineDelta = text.split("\n").length - 1;
    if (lineDelta === 0) {
        return pos.line === at.line ? { line: pos.line, character: pos.character + text.length } : pos;
    }
    return { line: pos.line + lineDelta, character: pos.character };
}

interface IMergedLineBlock {
    startLine: number;
    endLine: number;
    memberIndices: number[];
}

/** Adjacent blocks merge too, otherwise the edits would overlap (upstream: `endLineNumber + 1 >= startLineNumber`). */
function mergeAdjacentBlocks(selections: readonly ISelection[]): IMergedLineBlock[] {
    const merged: IMergedLineBlock[] = [];
    for (let i = 0; i < selections.length; i++) {
        const block = selectionLineBlock(selections[i]);
        const last = merged.at(-1);
        if (last !== undefined && block.startLine <= last.endLine + 1) {
            last.endLine = Math.max(last.endLine, block.endLine);
            last.memberIndices.push(i);
        } else {
            merged.push({ startLine: block.startLine, endLine: block.endLine, memberIndices: [i] });
        }
    }
    return merged;
}

/** A block at the document edge stays put; `null` means nothing to move. */
export function computeMoveLines(
    doc: ILineOperationsDocument,
    selections: readonly ISelection[],
    down: boolean,
): ILineOperationResult | null {
    const edits: ITextEdit[] = [];
    const movedSelections = new Set<number>();

    for (const block of mergeAdjacentBlocks(selections)) {
        if (down ? block.endLine >= doc.lineCount - 1 : block.startLine <= 0) continue;
        const text = blockText(doc, block);
        if (down) {
            const swapped = doc.getLineContent(block.endLine + 1);
            edits.push(
                createTextEdit(
                    createRange(block.startLine, 0, block.endLine + 1, doc.getLineLength(block.endLine + 1)),
                    swapped + "\n" + text,
                ),
            );
        } else {
            const swapped = doc.getLineContent(block.startLine - 1);
            edits.push(
                createTextEdit(
                    createRange(block.startLine - 1, 0, block.endLine, doc.getLineLength(block.endLine)),
                    text + "\n" + swapped,
                ),
            );
        }
        for (const index of block.memberIndices) {
            movedSelections.add(index);
        }
    }

    if (edits.length === 0) return null;

    const lineDelta = down ? 1 : -1;
    const afterSelections = selections.map((sel, i) =>
        movedSelections.has(i)
            ? createSelection(
                  sel.anchor.line + lineDelta,
                  sel.anchor.character,
                  sel.active.line + lineDelta,
                  sel.active.character,
              )
            : sel,
    );
    return { edits, afterSelections };
}

/**
 * Includes a bounding `\n`: usually its own trailing one; for a block with the last line, the
 * preceding one; for a block spanning the whole document, only the content (`DeleteLinesCommand`).
 */
function deleteWholeLinesEdit(doc: ILineOperationsDocument, block: { startLine: number; endLine: number }): ITextEdit {
    if (block.endLine < doc.lineCount - 1) {
        return createDeleteEdit(block.startLine, 0, block.endLine + 1, 0);
    }
    if (block.startLine > 0) {
        return createDeleteEdit(
            block.startLine - 1,
            doc.getLineLength(block.startLine - 1),
            block.endLine,
            doc.getLineLength(block.endLine),
        );
    }
    return createDeleteEdit(0, 0, block.endLine, doc.getLineLength(block.endLine));
}

/** A block's cursor goes to the column of its first selection; the applying side clamps it to the line length. */
export function computeDeleteLines(
    doc: ILineOperationsDocument,
    selections: readonly ISelection[],
): ILineOperationResult {
    const edits: ITextEdit[] = [];
    const afterSelections: ISelection[] = [];
    let removedSoFar = 0;

    for (const block of mergeAdjacentBlocks(selections)) {
        edits.push(deleteWholeLinesEdit(doc, block));
        // For a block with the last line this yields a line PAST the new end; the applying side's
        // clamp puts the cursor on the new end (as in upstream).
        afterSelections.push(
            createCursorSelection(block.startLine - removedSoFar, selections[block.memberIndices[0]].active.character),
        );
        removedSoFar += block.endLine - block.startLine + 1;
    }

    return { edits, afterSelections };
}

export interface ITextToCopy {
    /** Empty string means nothing to copy. */
    text: string;
    /** From a SINGLE empty selection: marks a whole-line paste above the cursor line. */
    isFromEmptySelection: boolean;
}

/**
 * Upstream `getPlainTextToCopy`: empty selections copy the whole line with `\n` (cursors on the
 * same line copy it once), joined with `\n`; with the setting off, empty selections yield nothing.
 */
export function computeTextToCopy(
    doc: ILineOperationsDocument,
    selections: readonly ISelection[],
    emptySelectionClipboard: boolean,
): ITextToCopy {
    const hasNonEmpty = selections.some((sel) => !isSelectionCollapsed(sel));

    if (!hasNonEmpty) {
        if (!emptySelectionClipboard) return { text: "", isFromEmptySelection: false };
        let text = "";
        let prevLine = -1;
        for (const sel of selections) {
            if (sel.active.line !== prevLine) {
                text += doc.getLineContent(sel.active.line) + "\n";
            }
            prevLine = sel.active.line;
        }
        return { text, isFromEmptySelection: selections.length === 1 };
    }

    const hasEmpty = selections.some(isSelectionCollapsed);
    if (hasEmpty && emptySelectionClipboard) {
        // Empty cursors contribute the line without its \n; the join supplies the separator.
        const parts: string[] = [];
        let prevLine = -1;
        for (const sel of selections) {
            const range = selectionToRange(sel);
            if (isSelectionCollapsed(sel)) {
                if (range.start.line !== prevLine) {
                    parts.push(doc.getLineContent(range.start.line));
                }
            } else {
                parts.push(doc.getTextInRange(range));
            }
            prevLine = range.start.line;
        }
        return { text: parts.join("\n"), isFromEmptySelection: false };
    }

    const parts = selections
        .filter((sel) => !isSelectionCollapsed(sel))
        .map((sel) => doc.getTextInRange(selectionToRange(sel)));
    return { text: parts.join("\n"), isFromEmptySelection: false };
}

/**
 * Cursors on adjacent lines merge ({@link mergeAdjacentBlocks}): a block with the last line
 * deletes the PRECEDING `\n` and without merging would contend for it with the edit of the line
 * above. A cursor on a line touched by a non-empty selection is skipped for the same reason.
 * Edit order doesn't matter.
 */
export function computeCutEdits(
    doc: ILineOperationsDocument,
    selections: readonly ISelection[],
    emptySelectionClipboard: boolean,
): ITextEdit[] {
    const nonEmpty = selections.filter((sel) => !isSelectionCollapsed(sel));
    const edits: ITextEdit[] = nonEmpty.map((sel) => createTextEdit(selectionToRange(sel), ""));
    if (!emptySelectionClipboard) return edits;

    const cutCarets = selections.filter((sel) => {
        const line = sel.active.line;
        return (
            isSelectionCollapsed(sel) &&
            !nonEmpty.some((other) => {
                const range = selectionToRange(other);
                return range.start.line <= line && line <= range.end.line;
            })
        );
    });
    for (const block of mergeAdjacentBlocks(cutCarets)) {
        edits.push(deleteWholeLinesEdit(doc, block));
    }
    return edits;
}
