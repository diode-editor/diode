import type { ICommentRule } from "../../../platform/extensions/common/iLanguageConfiguration.ts";
import type { ISelection } from "../../common/core/iSelection.ts";
import { createSelection, selectionToRange } from "../../common/core/iSelection.ts";
import type { ITextEdit } from "../../common/core/iTextEdit.ts";
import { getLeadingWhitespace } from "../../common/languages/autoIndent.ts";
import type { IUndoElement } from "../../common/model/iUndoElement.ts";
import type { EditorViewState } from "../../common/viewModel/editorViewState.ts";

import type { IBlockCommentPlan } from "./blockComments.ts";
import { planToggleBlockComment } from "./blockComments.ts";
import type { ILineShift, LineCommentMode } from "./lineComments.ts";
import { planLineComments, remapPositionForShifts } from "./lineComments.ts";

/** A selection end at column 0 does not count its line (as in VS Code). */
function touchedLines(sel: ISelection): number[] {
    const range = selectionToRange(sel);
    let endLine = range.end.line;
    if (endLine > range.start.line && range.end.character === 0) {
        endLine--;
    }
    const lines: number[] = [];
    for (let line = range.start.line; line <= endLine; line++) lines.push(line);
    return lines;
}

/**
 * The order is guaranteed by the `EditorViewState` setter (`sortAndMergeSelections`):
 * shifts from edits of neighbors on the same line accumulate left to right.
 */
function inDocumentOrder(viewState: EditorViewState): readonly ISelection[] {
    return viewState.selections;
}

export function toggleLineComment(viewState: EditorViewState, comments: ICommentRule): IUndoElement | undefined {
    return runLineComments(viewState, comments, "toggle");
}

export function addLineComment(viewState: EditorViewState, comments: ICommentRule): IUndoElement | undefined {
    return runLineComments(viewState, comments, "add");
}

export function removeLineComment(viewState: EditorViewState, comments: ICommentRule): IUndoElement | undefined {
    return runLineComments(viewState, comments, "remove");
}

function runLineComments(
    viewState: EditorViewState,
    comments: ICommentRule,
    mode: LineCommentMode,
): IUndoElement | undefined {
    const lineComment = comments.lineComment;
    if (lineComment === undefined) {
        // As in VS Code: toggle falls back to block tokens, forced add/remove are no-ops.
        return mode === "toggle" ? blockCommentLines(viewState, comments) : undefined;
    }

    const document = viewState.document;
    const usedLines = new Set<number>();
    const edits: ITextEdit[] = [];
    // Stryker disable next-line ArrayDeclaration: shift accumulator; an extra entry is unobservable:
    // it has no line, and remapPositionForShifts skips it (shift.line !== pos.line)
    const shifts: ILineShift[] = [];
    for (const sel of inDocumentOrder(viewState)) {
        // Two cursors on the same line comment it only once.
        const lines = touchedLines(sel).filter((line) => !usedLines.has(line));
        for (const line of lines) usedLines.add(line);

        const plan = planLineComments((line) => document.getLineContent(line), lines, lineComment, mode);
        if (plan !== null) {
            edits.push(...plan.edits);
            shifts.push(...plan.shifts);
        }
    }

    const remapped = viewState.selections.map((sel) => {
        const anchor = remapPositionForShifts(sel.anchor, shifts);
        const active = remapPositionForShifts(sel.active, shifts);
        return createSelection(anchor.line, anchor.character, active.line, active.character);
    });

    const element = viewState.applyEdits(edits, `${mode}LineComment`);
    if (element === undefined) return undefined;
    viewState.restoreSelections(remapped);
    return { ...element, afterSelections: viewState.cloneSelections() };
}

export function toggleBlockComment(viewState: EditorViewState, comments: ICommentRule): IUndoElement | undefined {
    const pair = comments.blockComment;
    if (pair === undefined) return undefined;

    const plans = inDocumentOrder(viewState).map((sel) =>
        planToggleBlockComment(viewState.document, selectionToRange(sel), pair[0], pair[1]),
    );
    return applyBlockCommentPlans(viewState, plans, "blockComment");
}

function blockCommentLines(viewState: EditorViewState, comments: ICommentRule): IUndoElement | undefined {
    const pair = comments.blockComment;
    if (pair === undefined) return undefined;

    const document = viewState.document;
    const plans = inDocumentOrder(viewState).map((sel) => {
        const lines = touchedLines(sel);
        const firstLine = lines[0];
        const lastLine = lines[lines.length - 1];
        const range = {
            start: { line: firstLine, character: getLeadingWhitespace(document.getLineContent(firstLine)).length },
            end: { line: lastLine, character: document.getLineLength(lastLine) },
        };
        return planToggleBlockComment(document, range, pair[0], pair[1]);
    });
    return applyBlockCommentPlans(viewState, plans, "toggleLineComment");
}

/**
 * Plans are built in isolation: edits of earlier plans on the same line shift the selection of
 * later ones (by columns only, since tokens contain no line breaks).
 */
function applyBlockCommentPlans(
    viewState: EditorViewState,
    plans: readonly IBlockCommentPlan[],
    label: string,
): IUndoElement | undefined {
    const edits: ITextEdit[] = [];
    const selections: ISelection[] = [];
    const lineDeltas = new Map<number, number>();
    for (const plan of plans) {
        const shift = (line: number): number => lineDeltas.get(line) ?? 0;
        selections.push(
            createSelection(
                plan.selection.anchor.line,
                plan.selection.anchor.character + shift(plan.selection.anchor.line),
                plan.selection.active.line,
                plan.selection.active.character + shift(plan.selection.active.line),
            ),
        );
        for (const edit of plan.edits) {
            edits.push(edit);
            const width = edit.range.end.character - edit.range.start.character;
            const line = edit.range.start.line;
            lineDeltas.set(line, (lineDeltas.get(line) ?? 0) + edit.text.length - width);
        }
    }
    const element = viewState.applyEdits(edits, label);
    if (element === undefined) return undefined;
    viewState.restoreSelections(selections);
    return { ...element, afterSelections: viewState.cloneSelections() };
}
