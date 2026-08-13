import type { MockTerminalBackend } from "../../tuidom/backend/mockTerminalBackend.ts";
import type { TUIElement } from "../../tuidom/dom/tuiElement.ts";
import type { IRenderElementOptions } from "../../tuidom/testing/renderElement.ts";
import { renderElement as tuidomRenderElement } from "../../tuidom/testing/renderElement.ts";
import { computeThemeVars } from "../vs/platform/theme/browser/themeStyleVars.ts";
import { WorkbenchTheme } from "../vs/platform/theme/common/workbenchTheme.ts";
import { darkPlusTheme } from "../vs/workbench/services/themes/common/themes/darkPlus.ts";

export type { IRenderElementOptions } from "../../tuidom/testing/renderElement.ts";

let cachedVars: Record<string, number> | null = null;
function liveThemeVars(): Record<string, number> {
    cachedVars ??= computeThemeVars(WorkbenchTheme.fromThemeFile(darkPlusTheme));
    return cachedVars;
}

/** Обёртка над tuidom-harness: `themeVars: true` кладёт живую палитру Dark+
 * (тем же кодом темы, что приложение), а не снапшот из tuidom/testing. */
export function renderElement(
    element: TUIElement,
    width: number,
    height: number,
    options: IRenderElementOptions = {},
): MockTerminalBackend {
    if (options.themeVars === true && options.styleVars === undefined) {
        options = { ...options, styleVars: liveThemeVars() };
    }
    return tuidomRenderElement(element, width, height, options);
}
