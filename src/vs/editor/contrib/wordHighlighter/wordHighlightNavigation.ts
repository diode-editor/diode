import { rangeContainsPosition } from "../../common/core/iRange.ts";
import { isSelectionCollapsed } from "../../common/core/iSelection.ts";
import type { EditorViewState } from "../../common/viewModel/editorViewState.ts";
import { computeWordOccurrences } from "../find/computeWordOccurrences.ts";

/**
 * Upstream `WordHighlighter.moveNext/moveBack`. Набор вхождений — тот же, что рисует
 * `EditorElement.getOccurrenceHighlights`: при мультикурсоре и непустом выделении подсветки
 * нет — и переходить не по чему (upstream гасит команду предусловием `hasWordHighlights`).
 */
export function moveToWordHighlight(viewState: EditorViewState, direction: 1 | -1): void {
    if (viewState.selections.length !== 1) return;
    const primary = viewState.selections[0];
    if (!isSelectionCollapsed(primary)) return;
    const highlights = computeWordOccurrences(viewState.document, primary.active);
    if (highlights.length === 0) return;
    // Границы включительно, как upstream `containsPosition`.
    const index = highlights.findIndex((range) => rangeContainsPosition(range, primary.active));
    const dest = highlights[(index + direction + highlights.length) % highlights.length];
    viewState.goToPosition(dest.start.line, dest.start.character);
}
