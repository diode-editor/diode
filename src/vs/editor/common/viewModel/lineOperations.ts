import type { IPosition } from "../core/iPosition.ts";
import { comparePositions } from "../core/iPosition.ts";
import { createRange } from "../core/iRange.ts";
import type { ISelection } from "../core/iSelection.ts";
import { createCursorSelection, createSelection, isSelectionCollapsed, selectionToRange } from "../core/iSelection.ts";
import type { ITextEdit } from "../core/iTextEdit.ts";
import { createDeleteEdit, createInsertEdit, createTextEdit } from "../core/iTextEdit.ts";
import type { ITextDocument } from "../model/iTextDocument.ts";

/** Вход `selections` — нормализованный список view-state'а: документный порядок, без пересечений. */
export type ILineOperationsDocument = Pick<
    ITextDocument,
    "lineCount" | "getLineContent" | "getLineLength" | "getTextInRange"
>;

export interface ILineOperationResult {
    edits: ITextEdit[];
    afterSelections: ISelection[];
}

/** Конец на колонке 0 следующей строки её не захватывает (семантика VS Code). */
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
 * Up держит выделение на верхней копии, Down — на нижней. Блоки, делящие строку, не
 * дублируют её дважды: дубль делает верхний (семантика VS Code).
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
    // Stryker disable next-line EqualityOperator: лишняя итерация читает kept[length] === undefined и гасится continue
    for (let i = 0; i < blocks.length; i++) {
        if (!kept[i]) continue;
        const text = blockText(doc, blocks[i]);
        if (down) {
            // Копия НАД блоком: оригинал съезжает вниз, выделение остаётся с ним.
            edits.push(createInsertEdit(blocks[i].startLine, 0, text + "\n"));
        } else {
            // Копия ПОД блоком: выделение остаётся на верхнем оригинале.
            edits.push(createInsertEdit(blocks[i].endLine, doc.getLineLength(blocks[i].endLine), "\n" + text));
        }
    }

    const shiftLine = (line: number): number => {
        let delta = 0;
        // Stryker disable next-line EqualityOperator: лишняя итерация читает kept[length] === undefined и гасится continue
        for (let j = 0; j < blocks.length; j++) {
            if (!kept[j]) continue;
            const size = blocks[j].endLine - blocks[j].startLine + 1;
            // Вставка-вниз стоит В НАЧАЛЕ блока и двигает сам блок; вставка-вверх — в конце
            // его последней строки и двигает только строки ниже.
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

/** В отличие от {@link computeCopyLines}, каретки на одной строке не схлопываются — каждая вставляет свою копию. */
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

    // Позиции переносятся ПРОГОНОМ вставок вместе с точками вставки: правка каретки встаёт
    // в начало строки, ЛЕВЕЕ правки выделения с той же строки, — накопительными дельтами
    // такое не описать. Порядок прогона не важен: сдвиги коммутируют.
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
 * Многострочная вставка правит только номер строки, не колонку — верно лишь в силу
 * инварианта дублирования (копия кончается тем, что стоит слева от `at`), поэтому
 * функция живёт здесь, а не в `core/`.
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

/** Смежные блоки тоже сливаются, иначе правки пересеклись бы (VS Code: `endLineNumber + 1 >= startLineNumber`). */
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

/** Блок у края документа остаётся на месте; `null` — двигать нечего. */
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
 * С ограничивающим `\n`: обычно своим завершающим, у блока с последней строкой —
 * предшествующим, у блока во весь документ — только содержимое (`DeleteLinesCommand`).
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

/** Каретка блока — в колонке его первого выделения; кламп к длине строки — у применяющей стороны. */
export function computeDeleteLines(
    doc: ILineOperationsDocument,
    selections: readonly ISelection[],
): ILineOperationResult {
    const edits: ITextEdit[] = [];
    const afterSelections: ISelection[] = [];
    let removedSoFar = 0;

    for (const block of mergeAdjacentBlocks(selections)) {
        edits.push(deleteWholeLinesEdit(doc, block));
        // У блока с последней строкой выражение даёт строку ЗА новым концом — кламп
        // применяющей стороны сажает каретку на новый конец (как в VS Code).
        afterSelections.push(
            createCursorSelection(block.startLine - removedSoFar, selections[block.memberIndices[0]].active.character),
        );
        removedSoFar += block.endLine - block.startLine + 1;
    }

    return { edits, afterSelections };
}

export interface ITextToCopy {
    /** Пустая строка — копировать нечего. */
    text: string;
    /** Из ЕДИНСТВЕННОГО пустого выделения — маркер линейной вставки строкой выше курсорной. */
    isFromEmptySelection: boolean;
}

/**
 * VS Code `getPlainTextToCopy`: пустые выделения копируют строку целиком с `\n` (каретки
 * на одной строке — один раз), склейка через `\n`; при выключенной настройке пустые не дают ничего.
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
        // Пустые каретки несут строку без своего \n — разделитель даёт склейка.
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
 * Каретки смежных строк сливаются ({@link mergeAdjacentBlocks}): блок с последней строкой
 * удаляет ПРЕДШЕСТВУЮЩИЙ `\n` и без слияния спорил бы за него с правкой строки выше. Каретка
 * на строке, задетой непустым выделением, пропускается по той же причине. Порядок правок не значим.
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
