import type { Size } from "@tuidom/core/common/geometryPromitives";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import type { BodyElement } from "@tuidom/elements/body/bodyElement";
import { TestApp as TuidomTestApp } from "@tuidom/testing/TestApp";

import { computeThemeVars } from "../vs/platform/theme/browser/themeStyleVars.ts";
import { WorkbenchTheme } from "../vs/platform/theme/common/workbenchTheme.ts";
import { darkPlusTheme } from "../vs/workbench/services/themes/common/themes/darkPlus.ts";

let cachedVars: Record<string, number> | null = null;
/** Not the tuidom/testing snapshot: tokens are resolved by the same theme code as in the app. */
function liveThemeVars(): Record<string, number> {
    cachedVars ??= computeThemeVars(WorkbenchTheme.fromThemeFile(darkPlusTheme));
    return cachedVars;
}

export type TestApp = TuidomTestApp;
export const TestApp = {
    create(root: BodyElement, size?: Size, styleVars?: Readonly<Record<string, number>>): TestApp {
        return TuidomTestApp.create(root, size, styleVars ?? liveThemeVars());
    },
    createWithContent(content: TUIElement, size?: Size): TestApp {
        return TuidomTestApp.createWithContent(content, size, liveThemeVars());
    },
};
