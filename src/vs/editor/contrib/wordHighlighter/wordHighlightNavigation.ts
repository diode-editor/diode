import { rangeContainsPosition } from "../../common/core/iRange.ts";
import { isSelectionCollapsed } from "../../common/core/iSelection.ts";
import type { EditorViewState } from "../../common/viewModel/editorViewState.ts";
import { computeWordOccurrences } from "../find/computeWordOccurrences.ts";

/**
 * F7 / Shift+F7: каретка на начало следующего/предыдущего подсвеченного вхождения слова
 * под ней (upstream `WordHighlighter.moveNext/moveBack`). Переход циклический; вхождение,
 * на которое встали, остаётся подсвеченным — слово под кареткой то же.
 *
 * Набор вхождений — тот же, что рисует `EditorElement.getOccurrenceHighlights`: подсветки
 * нет при мультикурсоре и непустом выделении, значит и переходить не по чему (upstream
 * гасит команду предусловием `hasWordHighlights`).
 */
export function moveToWordHighlight(viewState: EditorViewState, direction: 1 | -1): void {
    if (viewState.selections.length !== 1) return;
    const primary = viewState.selections[0];
    if (!isSelectionCollapsed(primary)) return;
    const highlights = computeWordOccurrences(viewState.document, primary.active);
    if (highlights.length === 0) return;
    // Первое вхождение, содержащее каретку (границы включительно, как upstream `containsPosition`).
    const index = highlights.findIndex((range) => rangeContainsPosition(range, primary.active));
    const dest = highlights[(index + direction + highlights.length) % highlights.length];
    viewState.goToPosition(dest.start.line, dest.start.character);
}
