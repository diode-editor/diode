import { MockTerminalBackend } from "../../tuidom/backend/mockTerminalBackend.ts";
import { BoxConstraints, Offset, Size } from "../../tuidom/common/geometryPromitives.ts";
import type { TUIElement } from "../../tuidom/dom/tuiElement.ts";
import { RenderContext } from "../../tuidom/dom/tuiElement.ts";
import { TerminalScreen } from "../../tuidom/rendering/terminalScreen.ts";

export interface IRenderElementOptions {
    /** Constraints для layout; по умолчанию `BoxConstraints.tight(size)` бэкенда. */
    readonly constraints?: BoxConstraints;
    /** Прогнать `performStyleResolution` перед render (нужно элементам с per-char стилями). */
    readonly resolveStyles?: boolean;
}

/**
 * Single-shot рендер standalone-элемента в {@link MockTerminalBackend}
 * заданного размера: layout → (опц.) style resolution → render → flush.
 * Результат скармливается прямо в `expectScreen`. Для мультифреймовых
 * сценариев или доступа к `TerminalScreen` — ручной сетап.
 */
export function renderElement(
    element: TUIElement,
    width: number,
    height: number,
    options: IRenderElementOptions = {},
): MockTerminalBackend {
    const size = new Size(width, height);
    const backend = new MockTerminalBackend(size);
    const termScreen = new TerminalScreen(size);
    // globalPosition производный: у элемента без родителя он равен localPosition.
    element.localPosition = new Offset(0, 0);
    element.performLayout(options.constraints ?? BoxConstraints.tight(size));
    if (options.resolveStyles === true) {
        element.performStyleResolution(element.resolvedStyle);
    }
    element.render(new RenderContext(termScreen));
    termScreen.flush(backend);
    return backend;
}
