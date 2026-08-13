import type { Size } from "@tuidom/all/common/geometryPromitives";
import type { TUIElement } from "@tuidom/all/dom/tuiElement";
import type { BodyElement } from "@tuidom/all/ui/body/bodyElement";
import { TestApp as TuidomTestApp } from "@tuidom/all/testing/TestApp";
import { computeThemeVars } from "../vs/platform/theme/browser/themeStyleVars.ts";
import { WorkbenchTheme } from "../vs/platform/theme/common/workbenchTheme.ts";
import { darkPlusTheme } from "../vs/workbench/services/themes/common/themes/darkPlus.ts";

let cachedVars: Record<string, number> | null = null;
/** Живая палитра Dark+ (не снапшот из tuidom/testing): vexx-тесты резолвят
 * токены ровно тем же кодом темы, что и приложение. */
function liveThemeVars(): Record<string, number> {
    cachedVars ??= computeThemeVars(WorkbenchTheme.fromThemeFile(darkPlusTheme));
    return cachedVars;
}

export type TestApp = TuidomTestApp;
export const TestApp = {
    create(root: BodyElement, size?: Size): TestApp {
        return TuidomTestApp.create(root, size, liveThemeVars());
    },
    createWithContent(content: TUIElement, size?: Size): TestApp {
        return TuidomTestApp.createWithContent(content, size, liveThemeVars());
    },
};
