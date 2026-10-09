import type { IPosition } from "../core/iPosition.ts";
import { comparePositions, createPosition, positionsEqual } from "../core/iPosition.ts";
import type { IRange } from "../core/iRange.ts";
import type { ISelection } from "../core/iSelection.ts";
import { createSelection, isSelectionCollapsed } from "../core/iSelection.ts";
import type { ITextEdit } from "../core/iTextEdit.ts";

/**
 * Выделения после программного батча правок — аналог `ICursorStateComputer`
 * эталона (`model.pushEditOperations`/`editor.executeEdits`). Получает обратные
 * правки В ПОРЯДКЕ ВХОДНОГО батча (а не документном): диапазон i-й обратной
 * правки накрывает текст, вставленный i-й правкой, в координатах нового
 * документа. `null` — «решай сам»: выделения сдвигаются вслед за правками
 * ({@link resolveTrackedSelections}), как у `executeEdits` без `endCursorState`.
 */
export type ICursorStateComputer = (inverseEdits: readonly ITextEdit[]) => ISelection[] | null;

/** Где окажется граница выделения: сдвиг вслед за правкой `edit` (−1 — до всех правок) или смещение внутрь её вставки. */
type IMarkerPlan =
    | { readonly kind: "shift"; readonly edit: number; readonly position: IPosition }
    | { readonly kind: "inEdit"; readonly edit: number; readonly offset: number };

interface ISelectionPlan {
    readonly start: IMarkerPlan;
    readonly end: IMarkerPlan;
    readonly collapsed: boolean;
    readonly reversed: boolean;
}

/** Снимок, снятый ДО применения батча: планы границ выделений. */
export interface ITrackedSelectionsPlan {
    readonly selections: readonly ISelectionPlan[];
}

/** Минимум документа для плана: длины текста внутри правок считаются по исходному документу. */
export interface ITrackedSelectionsSource {
    getTextInRange(range: IRange): string;
}

/**
 * Планирует, куда сдвинутся выделения при батче `edits` (документный порядок,
 * без перекрытий). Снимается ДО применения: смещение границы внутри
 * заменяемого диапазона меряется по исходному тексту.
 *
 * Семантика — маркеры эталона (`intervalTree.nodeAcceptEdit`) со стикостью
 * курсора `AlwaysGrowsWhenTypingAtEdges`: начало выделения липнет к тексту
 * слева, конец — нет. Удаление/замена, начинающаяся ровно на маркере, его не
 * двигает; маркер внутри общей части заменяемого и вставленного остаётся на
 * своём смещении; глубже — уезжает в конец вставки. Схлопнутая каретка,
 * которую вставка «растянула», схлопывается в конец (`readSelectionFromMarkers`
 * эталона: «не выделять текст при восстановлении из маркеров»).
 */
export function planTrackedSelections(
    source: ITrackedSelectionsSource,
    edits: readonly ITextEdit[],
    selections: readonly ISelection[],
): ITrackedSelectionsPlan {
    return {
        selections: selections.map((sel) => {
            const reversed = comparePositions(sel.active, sel.anchor) < 0;
            const start = reversed ? sel.active : sel.anchor;
            const end = reversed ? sel.anchor : sel.active;
            return {
                start: planMarker(source, edits, start, true),
                end: planMarker(source, edits, end, false),
                collapsed: isSelectionCollapsed(sel),
                reversed,
            };
        }),
    };
}

/**
 * Достраивает выделения по плану, когда батч уже применён: `edits` — тот же
 * документный порядок, что у плана, `inverseEdits` — обратные правки документа
 * (тоже в документном порядке, координаты нового документа).
 */
export function resolveTrackedSelections(
    plan: ITrackedSelectionsPlan,
    edits: readonly ITextEdit[],
    inverseEdits: readonly ITextEdit[],
): ISelection[] {
    return plan.selections.map((sel) => {
        const end = resolveMarker(sel.end, edits, inverseEdits);
        if (sel.collapsed) return createSelection(end.line, end.character, end.line, end.character);
        // Начало не обгоняет конец: внутри одной правки начало остаётся не
        // дальше общей части, а конец — не ближе неё (`nodeAcceptEdit`).
        const start = resolveMarker(sel.start, edits, inverseEdits);
        return sel.reversed
            ? createSelection(end.line, end.character, start.line, start.character)
            : createSelection(start.line, start.character, end.line, end.character);
    });
}

function planMarker(
    source: ITrackedSelectionsSource,
    edits: readonly ITextEdit[],
    position: IPosition,
    stickToPrevious: boolean,
): IMarkerPlan {
    const first = firstEditEndingAtOrAfter(edits, position);
    let last = first - 1;
    while (last + 1 < edits.length && comparePositions(edits[last + 1].range.start, position) <= 0) last++;
    if (last < first) return { kind: "shift", edit: first - 1, position };

    // Маркер накрыт правками first..last: у всех, кроме, может быть, первой,
    // начало ровно на маркере (стык). Эталон применяет батч снизу вверх:
    // правка, сдвинувшая маркер в свою вставку, уводит его за конец нижних.
    for (let j = last; j > first; j--) {
        const offset = offsetAfterEdit(source, edits[j], 0, stickToPrevious);
        if (offset !== 0) return { kind: "inEdit", edit: j, offset };
    }
    const edit = edits[first];
    const markerOffset = positionsEqual(edit.range.start, position)
        ? 0
        : source.getTextInRange({ start: edit.range.start, end: position }).length;
    return { kind: "inEdit", edit: first, offset: offsetAfterEdit(source, edit, markerOffset, stickToPrevious) };
}

/**
 * Смещение маркера от начала вставки после правки — `nodeAcceptEdit` эталона
 * без `forceMoveMarkers`, для маркера внутри [start, end] правки.
 */
function offsetAfterEdit(
    source: ITrackedSelectionsSource,
    edit: ITextEdit,
    markerOffset: number,
    stickToPrevious: boolean,
): number {
    const deleting = positionsEqual(edit.range.start, edit.range.end) ? 0 : source.getTextInRange(edit.range).length;
    const inserting = edit.text.length;
    if (markerOffset === 0 && (deleting > 0 || stickToPrevious)) return 0;
    const common = Math.min(deleting, inserting);
    const staysInCommon =
        markerOffset < common || (markerOffset === common && (deleting > inserting || stickToPrevious));
    return common > 0 && staysInCommon ? markerOffset : inserting;
}

/** Индекс первой правки, чей конец не раньше `position` (концы правок без перекрытий отсортированы). */
function firstEditEndingAtOrAfter(edits: readonly ITextEdit[], position: IPosition): number {
    let lo = 0;
    let hi = edits.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (comparePositions(edits[mid].range.end, position) < 0) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

function resolveMarker(plan: IMarkerPlan, edits: readonly ITextEdit[], inverseEdits: readonly ITextEdit[]): IPosition {
    if (plan.kind === "inEdit") {
        const start = inverseEdits[plan.edit].range.start;
        const lines = edits[plan.edit].text.slice(0, plan.offset).split("\n");
        const tail = lines[lines.length - 1];
        return lines.length === 1
            ? createPosition(start.line, start.character + plan.offset)
            : createPosition(start.line + lines.length - 1, tail.length);
    }
    if (plan.edit < 0) return plan.position;
    // Точка отсчёта — конец предыдущей правки в старых и новых координатах,
    // как в `TextDocument.computeInverseEdits`.
    const oldEnd = edits[plan.edit].range.end;
    const newEnd = inverseEdits[plan.edit].range.end;
    if (plan.position.line === oldEnd.line) {
        return createPosition(newEnd.line, newEnd.character + (plan.position.character - oldEnd.character));
    }
    return createPosition(plan.position.line + (newEnd.line - oldEnd.line), plan.position.character);
}
