import { MockTerminalBackend } from "../backend/mockTerminalBackend.ts";
import { BoxConstraints, Offset, Point, Rect, Size } from "../common/geometryPromitives.ts";
import { ROOT_STYLE_CONTEXT } from "../dom/styles/tuiStyle.ts";
import type { TUIElement } from "../dom/tuiElement.ts";
import { RenderContext } from "../dom/tuiElement.ts";
import { TerminalScreen } from "../rendering/terminalScreen.ts";
import { DARK_PLUS_STYLE_VARS } from "./darkPlusStyleVars.ts";

export interface IRenderElementOptions {
    /** Constraints для layout; по умолчанию `BoxConstraints.tight(size)` бэкенда. */
    readonly constraints?: BoxConstraints;
    /** Прогнать `performStyleResolution` перед render (нужно элементам с per-char стилями). */
    readonly resolveStyles?: boolean;
    /**
     * Положить палитру dark+ в var-scope элемента перед резолвом — для
     * хостовых компонентов, чьи токены (sideBar.*, statusBar.*) не имеют
     * дефолтов tuidom. Включает resolveStyles.
     */
    readonly themeVars?: boolean;
    /** Явная палитра var-scope вместо снапшота dark+. Включает resolveStyles. */
    readonly styleVars?: Readonly<Record<string, number>>;
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
    element.layout(options.constraints ?? BoxConstraints.tight(size));
    const styleVars = options.styleVars ?? (options.themeVars === true ? DARK_PLUS_STYLE_VARS : undefined);
    if (styleVars !== undefined) {
        element.setStyleVars(styleVars);
    }
    if (options.resolveStyles === true || styleVars !== undefined) {
        element.performStyleResolution(ROOT_STYLE_CONTEXT);
    }
    // Клип по краям экрана — как в TuiApplication: переполняющий layout не
    // должен писать за пределы grid (там нет bounds-чека, это crash).
    const screenClip = new Rect(new Point(0, 0), size);
    element.render(new RenderContext(termScreen, new Offset(0, 0), screenClip));
    termScreen.flush(backend);
    return backend;
}
