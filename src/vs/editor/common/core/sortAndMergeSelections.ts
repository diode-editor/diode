import { comparePositions } from "./iPosition.ts";
import type { IRange } from "./iRange.ts";
import type { ISelection } from "./iSelection.ts";
import { createSelection, isSelectionCollapsed, selectionToRange } from "./iSelection.ts";

/** Выделение вместе со своим нормализованным диапазоном и позицией во ВХОДНОМ массиве. */
interface IOrderedSelection {
    readonly selection: ISelection;
    readonly range: IRange;
    /** Индекс во входном массиве — «позже добавленный» побеждает при слиянии. */
    readonly index: number;
}

/**
 * Сортирует выделения в документном порядке и сливает пересекающиеся — наш аналог
 * `CursorCollection.normalize` из VS Code.
 *
 * Правило слияния пары (после сортировки по началу диапазона):
 * - хотя бы одно **схлопнуто** → сливаем даже КАСАЮЩИЕСЯ (`next.start <= cur.end`): каретка
 *   внутри чужого выделения и две каретки в одной точке — это один курсор;
 * - **оба непустые** → сливаем только настоящее пересечение (`next.start < cur.end`): два
 *   выделения встык (`ab|cd`) остаются разными, как в VS Code.
 *
 * Результат пары — диапазон-объединение. НАПРАВЛЕНИЕ (какой конец активен) наследуется от
 * позже добавленного участника — то есть от большего индекса во входном массиве: команды
 * мультикурсора дописывают новое выделение в хвост, значит именно им рулит пользователь.
 * `idealColumn` переносится, только если `active` победителя не сдвинулся; иначе он врал бы
 * про колонку (fallback `getIdealColumn` вернёт `active.character`).
 *
 * Сортировка сравнивает не только `start`, но и `end`: без тайбрейка порядок двух выделений
 * с общим началом держался бы лишь на стабильности `Array.prototype.sort`, а слиянию нужен
 * детерминизм.
 */
export function sortAndMergeSelections(selections: readonly ISelection[]): ISelection[] {
    // Быстрый путь: подавляющее большинство вызовов — один курсор.
    if (selections.length <= 1) return [...selections];

    const ordered: IOrderedSelection[] = selections.map((selection, index) => ({
        selection,
        range: selectionToRange(selection),
        index,
    }));
    ordered.sort(
        (a, b) =>
            comparePositions(a.range.start, b.range.start) || comparePositions(a.range.end, b.range.end),
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

/** Пересекаются ли соседи; касание считается пересечением, только если одно из них — каретка. */
function overlaps(previous: IOrderedSelection, current: IOrderedSelection): boolean {
    const touchCounts =
        isSelectionCollapsed(previous.selection) || isSelectionCollapsed(current.selection);
    const comparison = comparePositions(current.range.start, previous.range.end);
    return touchCounts ? comparison <= 0 : comparison < 0;
}

/** Объединение двух пересекающихся выделений; направление — от позже добавленного. */
function mergePair(previous: IOrderedSelection, current: IOrderedSelection): IOrderedSelection {
    const start = previous.range.start;
    const end = comparePositions(previous.range.end, current.range.end) >= 0 ? previous.range.end : current.range.end;
    const winner = current.index > previous.index ? current : previous;
    const activeIsEnd = comparePositions(winner.selection.anchor, winner.selection.active) <= 0;
    const active = activeIsEnd ? end : start;
    const anchor = activeIsEnd ? start : end;
    const idealColumn = comparePositions(winner.selection.active, active) === 0 ? winner.selection.idealColumn : undefined;

    return {
        selection: createSelection(anchor.line, anchor.character, active.line, active.character, idealColumn),
        range: { start, end },
        // Слияние наследует «возраст» победителя: каскад из трёх выделений должен и дальше
        // сравнивать себя с новичками по нему, а не по случайному участнику.
        index: winner.index,
    };
}
