import type { MockTerminalBackend } from "@tuidom/all/backend/mockTerminalBackend";
import type { TUIElement } from "@tuidom/all/dom/tuiElement";
import type { IRenderElementOptions } from "@tuidom/all/testing/renderElement";
import { renderElement as tuidomRenderElement } from "@tuidom/all/testing/renderElement";
import { computeThemeVars } from "../vs/platform/theme/browser/themeStyleVars.ts";
import { WorkbenchTheme } from "../vs/platform/theme/common/workbenchTheme.ts";
import { darkPlusTheme } from "../vs/workbench/services/themes/common/themes/darkPlus.ts";

export type { IRenderElementOptions } from "@tuidom/all/testing/renderElement";

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
