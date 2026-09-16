import type { IPosition } from "../core/iPosition.ts";
import { comparePositions } from "../core/iPosition.ts";
import { createRange } from "../core/iRange.ts";
import type { ISelection } from "../core/iSelection.ts";
import {
    createCursorSelection,
    createSelection,
    isSelectionCollapsed,
    selectionToRange,
} from "../core/iSelection.ts";
import type { ITextEdit } from "../core/iTextEdit.ts";
import { createDeleteEdit, createInsertEdit, createTextEdit } from "../core/iTextEdit.ts";
import type { ITextDocument } from "../model/iTextDocument.ts";

/**
 * Строчные операции редактора (перенос VS Code `editor/contrib/linesOperations`
 * и клипбордной семантики `emptySelectionClipboard`) — чистые функции: по
 * документу и выделениям считают правки и итоговые выделения, ничего не
 * применяя. Применяет их {@link EditorViewState} — там документ, фолды и undo.
 *
 * Контракт входа: `selections` — нормализованный список view-state'а
 * (документный порядок, без пересечений).
 */
export type ILineOperationsDocument = Pick<
    ITextDocument,
    "lineCount" | "getLineContent" | "getLineLength" | "getTextInRange"
>;

export interface ILineOperationResult {
    edits: ITextEdit[];
    afterSelections: ISelection[];
}

/** Строчный блок выделения: конец на колонке 0 следующей строки её не захватывает (семантика VS Code). */
function selectionLineBlock(sel: ISelection): { startLine: number; endLine: number } {
    const range = selectionToRange(sel);
    let endLine = range.end.line;
    if (endLine > range.start.line && range.end.character === 0) {
        endLine--;
    }
    return { startLine: range.start.line, endLine };
}

/** Строки блока, склеенные `\n` — вставляемый текст дублирования/перемещения. */
function blockText(doc: ILineOperationsDocument, block: { startLine: number; endLine: number }): string {
    const lines: string[] = [];
    for (let line = block.startLine; line <= block.endLine; line++) {
        lines.push(doc.getLineContent(line));
    }
    return lines.join("\n");
}

// ─── Duplicate lines (Copy Line Up / Down) ──────────────────

/**
 * Дублирование строк выделений (`editor.action.copyLinesUpAction/DownAction`).
 * Текст в обоих направлениях одинаков (копия встаёт вплотную к оригиналу);
 * различие — где остаётся выделение: Up держит его на верхней копии, Down — на
 * нижней. Два выделения, чьи блоки делят строку, не дублируют её дважды
 * (семантика VS Code: дубль делает верхнее, нижнее игнорируется).
 */
export function computeCopyLines(
    doc: ILineOperationsDocument,
    selections: readonly ISelection[],
    down: boolean,
): ILineOperationResult {
    const blocks = selections.map(selectionLineBlock);

    // Отсев блоков, наступающих на строку предыдущего оставленного блока.
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
            // Вставка-вниз стоит В НАЧАЛЕ блока и двигает сам блок; вставка-вверх
            // стоит в конце его последней строки и двигает только строки ниже.
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

// ─── Duplicate selection ────────────────────────────────────

/**
 * Дубль выделения (`editor.action.duplicateSelection`): копия выделенного
 * текста встаёт сразу за выделением и становится новым выделением; схлопнутая
 * каретка дублирует свою строку вниз (как Copy Line Down). В отличие от
 * {@link computeCopyLines}, каретки на одной строке не схлопываются — каждая
 * вставляет свою копию (семантика VS Code).
 */
export function computeDuplicateSelection(
    doc: ILineOperationsDocument,
    selections: readonly ISelection[],
): ILineOperationResult {
    const plans = selections.map((sel) => {
        const collapsed = isSelectionCollapsed(sel);
        const range = selectionToRange(sel);
        return {
            collapsed,
            // Каретка дублирует строку целиком (вставка в её начало), выделение —
            // свой текст (вставка сразу за ним).
            insertAt: collapsed ? { line: range.start.line, character: 0 } : range.end,
            text: collapsed ? doc.getLineContent(range.start.line) + "\n" : doc.getTextInRange(range),
            active: sel.active,
        };
    });

    // Позиции переносятся ПРОГОНОМ вставок в документном порядке, с переносом и
    // самих точек вставки: правка каретки встаёт в начало строки, то есть ЛЕВЕЕ
    // правки выделения с той же строки, и накопительными дельтами «сдвиг
    // последней тронутой строки» такой порядок не описывается.
    const insertPoints = plans.map((plan) => plan.insertAt);
    const carets = plans.map((plan) => plan.active);
    const order = plans.map((_, i) => i).sort((a, b) => comparePositions(plans[a].insertAt, plans[b].insertAt));
    for (const i of order) {
        const at = insertPoints[i];
        const text = plans[i].text;
        for (let k = 0; k < plans.length; k++) {
            // Точка собственной вставки не двигается: копия встаёт именно там.
            if (k !== i) insertPoints[k] = shiftThroughInsert(insertPoints[k], at, text);
            carets[k] = shiftThroughInsert(carets[k], at, text);
        }
    }

    const edits = plans.map((plan) => createInsertEdit(plan.insertAt.line, plan.insertAt.character, plan.text));
    const afterSelections = plans.map((plan, i) => {
        // Каретка остаётся у своего текста — тот съехал под копию строки.
        if (plan.collapsed) return createCursorSelection(carets[i].line, carets[i].character);
        // Новое выделение — вставленная копия.
        const start = insertPoints[i];
        const end = shiftThroughInsert(start, start, plan.text);
        return createSelection(start.line, start.character, end.line, end.character);
    });

    return { edits, afterSelections };
}

/**
 * Позиция после применения одной вставки `text` в точке `at`. Позиции левее
 * вставки не двигаются; на строке вставки хвост уезжает на последнюю строку
 * вставленного текста и продолжается сразу за ней.
 */
function shiftThroughInsert(pos: IPosition, at: IPosition, text: string): IPosition {
    if (comparePositions(pos, at) < 0) return pos;
    const insertedLines = text.split("\n");
    const lineDelta = insertedLines.length - 1;
    if (lineDelta === 0) {
        return pos.line === at.line ? { line: pos.line, character: pos.character + text.length } : pos;
    }
    if (pos.line === at.line) {
        return {
            line: pos.line + lineDelta,
            character: pos.character - at.character + insertedLines[lineDelta].length,
        };
    }
    return { line: pos.line + lineDelta, character: pos.character };
}

// ─── Move lines ─────────────────────────────────────────────

interface IMergedLineBlock {
    startLine: number;
    endLine: number;
    /** Индексы выделений, чьи блоки слились в этот. */
    memberIndices: number[];
}

/**
 * Слияние строчных блоков выделений: пересекающиеся И СМЕЖНЫЕ блоки едут/
 * удаляются одним куском — иначе их правки пересеклись бы (и VS Code сливает
 * так же: `endLineNumber + 1 >= startLineNumber` следующего).
 */
function mergeAdjacentBlocks(selections: readonly ISelection[]): IMergedLineBlock[] {
    const merged: IMergedLineBlock[] = [];
    for (let i = 0; i < selections.length; i++) {
        const block = selectionLineBlock(selections[i]);
        const last = merged[merged.length - 1];
        if (last !== undefined && block.startLine <= last.endLine + 1) {
            last.endLine = Math.max(last.endLine, block.endLine);
            last.memberIndices.push(i);
        } else {
            merged.push({ startLine: block.startLine, endLine: block.endLine, memberIndices: [i] });
        }
    }
    return merged;
}

/**
 * Перемещение строк выделений на строку вверх/вниз
 * (`editor.action.moveLinesUpAction/DownAction`): блок меняется местами с
 * соседней строкой, выделения переезжают вместе со своим текстом. Блок,
 * упёршийся в край документа, остаётся на месте; `null` — двигать нечего.
 */
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

// ─── Delete lines ───────────────────────────────────────────

/**
 * Правка, удаляющая строки блока ЦЕЛИКОМ, вместе с ограничивающим переводом
 * строки: обычно со своим завершающим, у блока с последней строкой документа —
 * с предшествующим (завершающего нет), у блока во весь документ — только
 * содержимое (документ без единственной строки не бывает). Семантика VS Code
 * (`DeleteLinesCommand` и cut пустого выделения).
 */
function deleteWholeLinesEdit(
    doc: ILineOperationsDocument,
    block: { startLine: number; endLine: number },
): ITextEdit {
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

/**
 * Удаление строк выделений (`editor.action.deleteLines`, Ctrl+Shift+K).
 * Смежные блоки сливаются в один; после удаления на месте каждого блока
 * остаётся каретка в прежней колонке (колонка первого выделения блока —
 * кламп к длине строки делает применяющая сторона).
 */
export function computeDeleteLines(
    doc: ILineOperationsDocument,
    selections: readonly ISelection[],
): ILineOperationResult {
    const edits: ITextEdit[] = [];
    const afterSelections: ISelection[] = [];
    let removedSoFar = 0;

    for (const block of mergeAdjacentBlocks(selections)) {
        edits.push(deleteWholeLinesEdit(doc, block));
        // Строка, вставшая на место блока. У блока с последней строкой документа
        // такой строки нет — выражение даёт строку ЗА новым концом, и кламп
        // применяющей стороны сажает каретку на новый конец (как в VS Code).
        afterSelections.push(
            createCursorSelection(block.startLine - removedSoFar, selections[block.memberIndices[0]].active.character),
        );
        removedSoFar += block.endLine - block.startLine + 1;
    }

    return { edits, afterSelections };
}

// ─── Clipboard: emptySelectionClipboard ─────────────────────

export interface ITextToCopy {
    /** Текст для буфера; пустая строка — копировать нечего. */
    text: string;
    /**
     * Текст пришёл из ЕДИНСТВЕННОГО пустого выделения — маркер линейной
     * вставки: paste такой строки кладёт её строкой выше курсорной.
     */
    isFromEmptySelection: boolean;
}

/**
 * Текст для Copy/Cut с семантикой `emptySelectionClipboard` (VS Code
 * `getPlainTextToCopy`): пустые выделения копируют свою строку целиком (с
 * `\n`; соседние каретки на одной строке — один раз), непустые — свой текст;
 * склейка — через `\n`. При выключенной настройке пустые выделения не дают
 * ничего.
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
        // Смешанный набор: пустые каретки несут строку целиком (без своего \n —
        // разделителем служит склейка), непустые — выделенное.
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
 * Правки для Cut: непустые выделения удаляют свой диапазон; пустые (при
 * включённом `emptySelectionClipboard`) — свою строку целиком. Каретки
 * смежных строк сливаются в один блок ({@link mergeAdjacentBlocks}): текст и
 * итоговые каретки от слияния не меняются, а правки перестают пересекаться —
 * блок с последней строкой документа удаляет ПРЕДШЕСТВУЮЩИЙ `\n`, и без
 * слияния он спорил бы за него с правкой строки выше. Каретка на строке,
 * которую уже задевает непустое выделение, пропускается — по той же причине.
 * Порядок правок не значим: применяющая сторона сортирует сама.
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
