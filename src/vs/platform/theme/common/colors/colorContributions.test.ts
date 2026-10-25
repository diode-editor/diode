import { describe, expect, it } from "vitest";

import { builtinThemes } from "../../../../workbench/services/themes/common/themes/builtinThemes.ts";
import { type ColorContribution, isColorReference } from "../colorRegistry.ts";
import { WorkbenchTheme } from "../workbenchTheme.ts";

import { baseColors } from "./baseColors.ts";
import { chartsColors } from "./chartsColors.ts";
import { COLOR_CONTRIBUTIONS, type IWorkbenchColors } from "./colorContributions.ts";
import { controlColors } from "./controlColors.ts";
import { diffColors } from "./diffColors.ts";
import { editorColors } from "./editorColors.ts";
import { gitColors } from "./gitColors.ts";
import { scmGraphColors } from "./scmGraphColors.ts";
import { terminalColors } from "./terminalColors.ts";
import { workbenchColors } from "./workbenchColors.ts";

/** Keep in sync with `getRequiredColor(...)` calls: a color without a registry default fails the test on themes lacking it. */
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
    "list.errorForeground",
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

    /** On the registry, not on themes: a theme may accidentally mask a broken reference. */
    it("reference defaults point at registered keys with defaults and form no cycles", () => {
        const contributions: ColorContribution = COLOR_CONTRIBUTIONS;
        for (const [key, definition] of Object.entries(contributions)) {
            if (definition.defaults === null) continue;
            for (const kind of ["dark", "light"] as const) {
                const trail = [key];
                let value = definition.defaults[kind];
                while (isColorReference(value)) {
                    expect(trail, `reference cycle ${[...trail, value].join(" → ")}`).not.toContain(value);
                    const target = contributions[value];
                    expect(target, `"${key}" (${kind}) references unregistered "${value}"`).toBeDefined();
                    expect(target.defaults, `"${value}" has no defaults, but "${key}" references it`).not.toBeNull();
                    trail.push(value);
                    value = target.defaults![kind];
                }
                expect(value, `"${trail.at(-1) ?? key}" (${kind}): not hex`).toMatch(
                    /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/,
                );
            }
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
            terminalColors,
            chartsColors,
        ];
        const totalKeys = groups.reduce((sum, group) => sum + Object.keys(group).length, 0);
        expect(Object.keys(COLOR_CONTRIBUTIONS)).toHaveLength(totalKeys);
    });
});
