import { comparePositions } from "./iPosition.ts";
import type { IRange } from "./iRange.ts";
import type { ISelection } from "./iSelection.ts";
import { createSelection, isSelectionCollapsed, selectionToRange } from "./iSelection.ts";

interface IOrderedSelection {
    readonly selection: ISelection;
    readonly range: IRange;
    /** Index in the input array: the "later added" one wins on merge. */
    readonly index: number;
}

/**
 * Like VS Code `CursorCollection.normalize`. Touching merges only if one of the pair
 * is a cursor: two adjacent selections (`ab|cd`) stay separate.
 * Direction is inherited from the later added one: multi-cursor appends the new
 * selection at the end, and that is the one the user is steering. `idealColumn` is carried
 * over only if the winner's `active` did not move; otherwise it would lie about the column.
 */
export function sortAndMergeSelections(selections: readonly ISelection[]): ISelection[] {
    // Stryker disable next-line EqualityOperator: for a single selection the long path returns the same object (sort and merge on one element are no-ops), so the threshold is only about speed; both bounds reject empty input the same way
    if (selections.length <= 1) return [...selections];

    const ordered: IOrderedSelection[] = selections.map((selection, index) => ({
        selection,
        range: selectionToRange(selection),
        index,
    }));
    // Tie-break on `end`: merging needs determinism, not `sort` stability.
    ordered.sort(
        (a, b) => comparePositions(a.range.start, b.range.start) || comparePositions(a.range.end, b.range.end),
    );

    const merged: IOrderedSelection[] = [ordered[0]];
    for (let i = 1; i < ordered.length; i++) {
        const previous = merged[merged.length - 1];
        const current = ordered[i];
        if (overlaps(previous, current)) {
            merged[merged.length - 1] = mergePair(previous, current);
        } else {
            merged.push(current);
        }
    }

    return merged.map((entry) => entry.selection);
}

function overlaps(previous: IOrderedSelection, current: IOrderedSelection): boolean {
    const touchCounts = isSelectionCollapsed(previous.selection) || isSelectionCollapsed(current.selection);
    const comparison = comparePositions(current.range.start, previous.range.end);
    return touchCounts ? comparison <= 0 : comparison < 0;
}

function mergePair(previous: IOrderedSelection, current: IOrderedSelection): IOrderedSelection {
    const start = previous.range.start;
    // Stryker disable next-line EqualityOperator: when the comparison is zero both ends are the same position, and either branch gives an equal value
    const end = comparePositions(previous.range.end, current.range.end) >= 0 ? previous.range.end : current.range.end;
    // Stryker disable next-line EqualityOperator: index is the original array position and previous and current are always different elements, so they are never equal
    const winner = current.index > previous.index ? current : previous;
    const activeIsEnd = comparePositions(winner.selection.anchor, winner.selection.active) <= 0;
    const active = activeIsEnd ? end : start;
    const anchor = activeIsEnd ? start : end;
    const idealColumn =
        comparePositions(winner.selection.active, active) === 0 ? winner.selection.idealColumn : undefined;

    return {
        selection: createSelection(anchor.line, anchor.character, active.line, active.character, idealColumn),
        range: { start, end },
        // A cascade of three selections compares itself with newcomers by the winner's age.
        index: winner.index,
    };
}
