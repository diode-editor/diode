import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import type { MockTerminalBackend } from "@tuidom/testing/mockTerminalBackend";
import type { IRenderElementOptions } from "@tuidom/testing/renderElement";
import { renderElement as tuidomRenderElement } from "@tuidom/testing/renderElement";

import { computeThemeVars } from "../vs/platform/theme/browser/themeStyleVars.ts";
import { WorkbenchTheme } from "../vs/platform/theme/common/workbenchTheme.ts";
import { darkPlusTheme } from "../vs/workbench/services/themes/common/themes/darkPlus.ts";

export type { IRenderElementOptions } from "@tuidom/testing/renderElement";

let cachedVars: Record<string, number> | null = null;
function liveThemeVars(): Record<string, number> {
    cachedVars ??= computeThemeVars(WorkbenchTheme.fromThemeFile(darkPlusTheme));
    return cachedVars;
}

/** `themeVars: true` — живая палитра Dark+ (код темы приложения), а не снапшот из tuidom/testing. */
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
