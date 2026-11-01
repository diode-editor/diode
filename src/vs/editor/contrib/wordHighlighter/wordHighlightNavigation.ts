import { rangeContainsPosition } from "../../common/core/iRange.ts";
import type { EditorViewState } from "../../common/viewModel/editorViewState.ts";

/**
 * Upstream `WordHighlighter.moveNext/moveBack`: walks the set on the frame, whoever computed it
 * (a provider or the textual search). Without a set there is nothing to move to; the actions have the
 * `hasWordHighlights` precondition.
 */
export function moveToWordHighlight(viewState: EditorViewState, direction: 1 | -1): void {
    const highlights = viewState.wordHighlights.ranges;
    if (highlights.length === 0) return;
    const position = viewState.selections[0].active;
    // Inclusive bounds, like upstream `containsPosition`.
    const index = highlights.findIndex((range) => rangeContainsPosition(range, position));
    const dest = highlights[(index + direction + highlights.length) % highlights.length];
    viewState.goToPosition(dest.start.line, dest.start.character);
}
