import type { IPosition } from "../core/iPosition.ts";
import { comparePositions, createPosition, positionsEqual } from "../core/iPosition.ts";
import type { IRange } from "../core/iRange.ts";
import type { ISelection } from "../core/iSelection.ts";
import { createSelection, isSelectionCollapsed } from "../core/iSelection.ts";
import type { ITextEdit } from "../core/iTextEdit.ts";

/**
 * Аналог `ICursorStateComputer` эталона. Обратные правки — В ПОРЯДКЕ ВХОДНОГО батча, а не
 * документном. `null` — выделения сдвигаются вслед за правками, как у `executeEdits` без `endCursorState`.
 */
export type ICursorStateComputer = (inverseEdits: readonly ITextEdit[]) => ISelection[] | null;

/** `edit: −1` — до всех правок. */
type IMarkerPlan =
    | { readonly kind: "shift"; readonly edit: number; readonly position: IPosition }
    | { readonly kind: "inEdit"; readonly edit: number; readonly offset: number };

interface ISelectionPlan {
    readonly start: IMarkerPlan;
    readonly end: IMarkerPlan;
    readonly collapsed: boolean;
    readonly reversed: boolean;
}

/** Снимается ДО применения батча. */
export interface ITrackedSelectionsPlan {
    readonly selections: readonly ISelectionPlan[];
}

/** Длины текста внутри правок считаются по исходному документу. */
export interface ITrackedSelectionsSource {
    getTextInRange(range: IRange): string;
}

/**
 * Маркеры эталона (`intervalTree.nodeAcceptEdit`) со стикостью `AlwaysGrowsWhenTypingAtEdges`:
 * начало выделения липнет к тексту слева, конец — нет. Схлопнутая каретка, которую вставка
 * «растянула», схлопывается в конец (`readSelectionFromMarkers`).
 */
export function planTrackedSelections(
    source: ITrackedSelectionsSource,
    edits: readonly ITextEdit[],
    selections: readonly ISelection[],
): ITrackedSelectionsPlan {
    return {
        selections: selections.map((sel) => {
            // Stryker disable next-line EqualityOperator: равенство — схлопнутая каретка, у неё направления нет
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

/** `edits` и `inverseEdits` — в документном порядке, как у плана. */
export function resolveTrackedSelections(
    plan: ITrackedSelectionsPlan,
    edits: readonly ITextEdit[],
    inverseEdits: readonly ITextEdit[],
): ISelection[] {
    return plan.selections.map((sel) => {
        const end = resolveMarker(sel.end, edits, inverseEdits);
        if (sel.collapsed) return createSelection(end.line, end.character, end.line, end.character);
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
    // Stryker disable next-line StringLiteral: resolveMarker различает только "inEdit", любая другая метка — сдвиг
    if (last < first) return { kind: "shift", edit: first - 1, position };

    // Эталон применяет батч снизу вверх: правка, сдвинувшая маркер в свою вставку,
    // уводит его за конец нижних (у всех, кроме первой, начало ровно на маркере).
    // Stryker disable next-line EqualityOperator: на j === first смещение 0 даёт не-0 только вставке ровно в маркер, где и полное смещение — 0
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

/** `nodeAcceptEdit` эталона без `forceMoveMarkers`. */
function offsetAfterEdit(
    source: ITrackedSelectionsSource,
    edit: ITextEdit,
    markerOffset: number,
    stickToPrevious: boolean,
): number {
    const deleting = positionsEqual(edit.range.start, edit.range.end) ? 0 : source.getTextInRange(edit.range).length;
    const inserting = edit.text.length;
    // На конце общей части остаётся только липкий влево; в вырожденных случаях
    // «остаться» и «уехать в конец вставки» — одна точка.
    const common = Math.min(deleting, inserting);
    return markerOffset < common || (markerOffset === common && stickToPrevious) ? markerOffset : inserting;
}

/** Концы правок без перекрытий отсортированы — бинпоиск. */
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
    // Точка отсчёта — конец предыдущей правки, как в `TextDocument.computeInverseEdits`.
    const oldEnd = edits[plan.edit].range.end;
    const newEnd = inverseEdits[plan.edit].range.end;
    if (plan.position.line === oldEnd.line) {
        return createPosition(newEnd.line, newEnd.character + (plan.position.character - oldEnd.character));
    }
    return createPosition(plan.position.line + (newEnd.line - oldEnd.line), plan.position.character);
}
