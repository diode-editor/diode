import type { IPosition } from "../core/iPosition.ts";
import { comparePositions, createPosition, positionsEqual } from "../core/iPosition.ts";
import type { IRange } from "../core/iRange.ts";
import type { ISelection } from "../core/iSelection.ts";
import { createSelection, isSelectionCollapsed } from "../core/iSelection.ts";
import type { ITextEdit } from "../core/iTextEdit.ts";

/**
 * Mirrors upstream `ICursorStateComputer`. Inverse edits come IN INPUT BATCH ORDER, not document
 * order. `null` means selections follow the edits, as with `executeEdits` without `endCursorState`.
 */
export type ICursorStateComputer = (inverseEdits: readonly ITextEdit[]) => ISelection[] | null;

/** `edit: −1` means before all edits. */
type IMarkerPlan =
    | { readonly kind: "shift"; readonly edit: number; readonly position: IPosition }
    | { readonly kind: "inEdit"; readonly edit: number; readonly offset: number };

interface ISelectionPlan {
    readonly start: IMarkerPlan;
    readonly end: IMarkerPlan;
    readonly collapsed: boolean;
    readonly reversed: boolean;
}

/** Taken BEFORE the batch is applied. */
export interface ITrackedSelectionsPlan {
    readonly selections: readonly ISelectionPlan[];
}

/** Text lengths inside edits are measured against the original document. */
export interface ITrackedSelectionsSource {
    getTextInRange(range: IRange): string;
}

/**
 * Upstream markers (`intervalTree.nodeAcceptEdit`) with `AlwaysGrowsWhenTypingAtEdges` stickiness:
 * the selection start sticks to the text on its left, the end doesn't. A collapsed cursor that an
 * insert "stretched" collapses to the end (`readSelectionFromMarkers`).
 */
export function planTrackedSelections(
    source: ITrackedSelectionsSource,
    edits: readonly ITextEdit[],
    selections: readonly ISelection[],
): ITrackedSelectionsPlan {
    return {
        selections: selections.map((sel) => {
            // Stryker disable next-line EqualityOperator: equality means a collapsed cursor, which has no direction
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

/** `edits` and `inverseEdits` are in document order, as in the plan. */
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
    // Stryker disable next-line StringLiteral: resolveMarker only distinguishes "inEdit", any other tag is a shift
    if (last < first) return { kind: "shift", edit: first - 1, position };

    // Upstream applies the batch bottom-up: an edit that moved the marker into its insert
    // carries it past the end of the lower ones (all but the first start exactly at the marker).
    // Stryker disable next-line EqualityOperator: at j === first, offset 0 yields non-0 only for an insert exactly at the marker, where the full offset is 0 too
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

/** Upstream `nodeAcceptEdit` without `forceMoveMarkers`. */
function offsetAfterEdit(
    source: ITrackedSelectionsSource,
    edit: ITextEdit,
    markerOffset: number,
    stickToPrevious: boolean,
): number {
    const deleting = positionsEqual(edit.range.start, edit.range.end) ? 0 : source.getTextInRange(edit.range).length;
    const inserting = edit.text.length;
    // At the end of the common part only a left-sticky marker stays; in degenerate cases
    // "stay" and "move to the end of the insert" are the same point.
    const common = Math.min(deleting, inserting);
    return markerOffset < common || (markerOffset === common && stickToPrevious) ? markerOffset : inserting;
}

/** Non-overlapping edits have sorted ends, hence binary search. */
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
    // Relative to the end of the preceding edit, as in `TextDocument.computeInverseEdits`.
    const oldEnd = edits[plan.edit].range.end;
    const newEnd = inverseEdits[plan.edit].range.end;
    if (plan.position.line === oldEnd.line) {
        return createPosition(newEnd.line, newEnd.character + (plan.position.character - oldEnd.character));
    }
    return createPosition(plan.position.line + (newEnd.line - oldEnd.line), plan.position.character);
}
