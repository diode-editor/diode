import { describe, expect, it } from "vitest";

import { builtinThemes } from "../../../../workbench/services/themes/common/themes/builtinThemes.ts";
import type { ColorContribution } from "../colorRegistry.ts";
import { WorkbenchTheme } from "../workbenchTheme.ts";

import { baseColors } from "./baseColors.ts";
import { COLOR_CONTRIBUTIONS, type IWorkbenchColors } from "./colorContributions.ts";
import { controlColors } from "./controlColors.ts";
import { diffColors } from "./diffColors.ts";
import { editorColors } from "./editorColors.ts";
import { gitColors } from "./gitColors.ts";
import { scmGraphColors } from "./scmGraphColors.ts";
import { workbenchColors } from "./workbenchColors.ts";

/**
 * Every workbench color the app reads through `getRequiredColor` must resolve on
 * every built-in theme — either the theme defines it, or the color
 * definitions (src/Theme/colors/) fill it. This is the guard behind the
 * architecture rule "no hardcoded color fallbacks in UI code": if a feature adds
 * a required color without a registry default, this test fails for the themes
 * that omit it.
 *
 * Keep this list in sync with the `getRequiredColor(...)` call sites.
 */
const REQUIRED_COLORS: (keyof IWorkbenchColors)[] = [
    "foreground",
    "sash.hoverBorder",
    "editor.foreground",
    "editor.background",
    "editorGroupHeader.tabsBackground",
    "tab.activeBackground",
    "tab.activeForeground",
    "tab.inactiveBackground",
    "tab.inactiveForeground",
    "sideBar.background",
    "sideBar.foreground",
    "statusBar.background",
    "statusBar.foreground",
    "statusBarItem.hoverBackground",
    "statusBarItem.hoverForeground",
    "list.activeSelectionBackground",
    "list.activeSelectionForeground",
    "list.inactiveSelectionBackground",
    "list.inactiveSelectionForeground",
    "list.hoverBackground",
    "list.deemphasizedForeground",
    "button.background",
    "button.foreground",
    "button.hoverBackground",
    "button.secondaryBackground",
    "button.secondaryForeground",
    "button.secondaryHoverBackground",
    "menu.foreground",
    "menu.background",
    "menu.selectionForeground",
    "menu.selectionBackground",
    "menu.border",
    "menu.separatorBackground",
];

describe("default color registry coverage", () => {
    for (const themeFile of builtinThemes) {
        it(`resolves every required color for "${themeFile.name ?? "Unnamed"}"`, () => {
            const theme = WorkbenchTheme.fromThemeFile(themeFile);
            for (const key of REQUIRED_COLORS) {
                expect(() => theme.getRequiredColor(key), `missing "${key}"`).not.toThrow();
            }
        });
    }

    /**
     * Инвариант, на который опирается композитинг в `WorkbenchTheme`: и сам
     * blendOver-цвет, и его подложка обязаны иметь дефолты. Иначе наложение
     * получило бы `undefined` и выдало NaN вместо цвета.
     */
    it("blendOver-цвета и их подложки объявлены с дефолтами", () => {
        const contributions: ColorContribution = COLOR_CONTRIBUTIONS;
        for (const [key, definition] of Object.entries(contributions)) {
            if (definition.blendOver === undefined) continue;
            expect(definition.defaults, `"${key}" без дефолтов`).not.toBeNull();
            const backdrop = contributions[definition.blendOver];
            expect(backdrop, `подложка "${definition.blendOver}" не зарегистрирована`).toBeDefined();
            expect(backdrop.defaults, `подложка "${definition.blendOver}" без дефолтов`).not.toBeNull();
        }
    });

    it("group files declare disjoint key sets (a spread would silently override a duplicate)", () => {
        const groups = [
            baseColors,
            controlColors,
            editorColors,
            diffColors,
            workbenchColors,
            gitColors,
            scmGraphColors,
        ];
        const totalKeys = groups.reduce((sum, group) => sum + Object.keys(group).length, 0);
        expect(Object.keys(COLOR_CONTRIBUTIONS)).toHaveLength(totalKeys);
    });
});
