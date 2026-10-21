import { comparePositions } from "./iPosition.ts";
import type { IRange } from "./iRange.ts";
import type { ISelection } from "./iSelection.ts";
import { createSelection, isSelectionCollapsed, selectionToRange } from "./iSelection.ts";

interface IOrderedSelection {
    readonly selection: ISelection;
    readonly range: IRange;
    /** Индекс во входном массиве — «позже добавленный» побеждает при слиянии. */
    readonly index: number;
}

/**
 * Аналог `CursorCollection.normalize` из VS Code. Касание сливается, только если
 * одно из пары — каретка: два выделения встык (`ab|cd`) остаются разными.
 * Направление наследуется от позже добавленного: мультикурсор дописывает новое
 * выделение в хвост, им и рулит пользователь. `idealColumn` переносится, только
 * если `active` победителя не сдвинулся — иначе он врал бы про колонку.
 */
export function sortAndMergeSelections(selections: readonly ISelection[]): ISelection[] {
    // Stryker disable next-line EqualityOperator: на одном выделении длинный путь возвращает тот же объект (сортировка и слияние на единственном элементе — no-op), так что порог — только про скорость; пустой вход обе границы отсекают одинаково
    if (selections.length <= 1) return [...selections];

    const ordered: IOrderedSelection[] = selections.map((selection, index) => ({
        selection,
        range: selectionToRange(selection),
        index,
    }));
    // Тайбрейк по `end`: слиянию нужен детерминизм, а не стабильность `sort`.
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
    // Stryker disable next-line EqualityOperator: при нулевом сравнении оба конца — одна и та же позиция, и любая из ветвей даёт равное значение
    const end = comparePositions(previous.range.end, current.range.end) >= 0 ? previous.range.end : current.range.end;
    // Stryker disable next-line EqualityOperator: index — исходная позиция в массиве, а previous и current всегда разные элементы, поэтому равенства не бывает
    const winner = current.index > previous.index ? current : previous;
    const activeIsEnd = comparePositions(winner.selection.anchor, winner.selection.active) <= 0;
    const active = activeIsEnd ? end : start;
    const anchor = activeIsEnd ? start : end;
    const idealColumn =
        comparePositions(winner.selection.active, active) === 0 ? winner.selection.idealColumn : undefined;

    return {
        selection: createSelection(anchor.line, anchor.character, active.line, active.character, idealColumn),
        range: { start, end },
        // Каскад из трёх выделений сравнивает себя с новичками по возрасту победителя.
        index: winner.index,
    };
}
