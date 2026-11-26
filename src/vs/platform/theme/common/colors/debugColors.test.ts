import { describe, expect, it } from "vitest";

import { parseHexColor } from "../colorUtils.ts";
import type { IThemeFile } from "../iThemeFile.ts";
import { WorkbenchTheme } from "../workbenchTheme.ts";

import type { IWorkbenchColors } from "./colorContributions.ts";

/** Upstream defaults (`contrib/debug/browser/*`), the references resolved on our palettes. */
const EXPECTED: Record<"dark" | "light", Partial<Record<keyof IWorkbenchColors, string>>> = {
    dark: {
        "debugToolBar.background": "#333333",
        "debugIcon.startForeground": "#89D185",
        "debugTokenExpression.name": "#c586c0",
        "debugTokenExpression.value": "#cccccc99",
        "debugView.exceptionLabelForeground": "#CCCCCC",
        "debugView.stateLabelForeground": "#CCCCCC",
        "debugConsole.infoForeground": "#3794FF",
        "debugConsole.warningForeground": "#CCA700",
        "debugConsole.errorForeground": "#F48771",
        "debugConsole.sourceForeground": "#CCCCCC",
        "debugConsoleInputIcon.foreground": "#CCCCCC",
        "debugIcon.breakpointForeground": "#E51400",
        "debugIcon.breakpointUnverifiedForeground": "#848484",
        "debugIcon.breakpointCurrentStackframeForeground": "#FFCC00",
        "editor.stackFrameHighlightBackground": "#ffff0033",
        "statusBar.debuggingBackground": "#CC6633",
        "statusBar.debuggingForeground": "#FFFFFF",
        "commandCenter.debuggingBackground": "#CC663342",
    },
    light: {
        "debugToolBar.background": "#F3F3F3",
        "debugIcon.startForeground": "#388A34",
        "debugTokenExpression.name": "#9b46b0",
        "debugTokenExpression.value": "#6c6c6ccc",
        "debugView.exceptionLabelForeground": "#FFFFFF",
        "debugView.stateLabelForeground": "#3B3B3B",
        "debugConsole.infoForeground": "#1A85FF",
        "debugConsole.warningForeground": "#BF8803",
        "debugConsole.errorForeground": "#A1260D",
        "debugConsole.sourceForeground": "#3B3B3B",
        "debugIcon.breakpointForeground": "#E51400",
        "debugIcon.breakpointCurrentStackframeForeground": "#BE8700",
        "editor.stackFrameHighlightBackground": "#ffff6673",
        "statusBar.debuggingBackground": "#CC6633",
        "statusBar.debuggingForeground": "#3B3B3B",
    },
};

const KIND_TO_TYPE: Record<"dark" | "light", IThemeFile["type"]> = { dark: "dark", light: "light" };

describe("debug color defaults", () => {
    for (const kind of ["dark", "light"] as const) {
        const theme = WorkbenchTheme.fromThemeFile({ type: KIND_TO_TYPE[kind], colors: {} });

        for (const [key, hex] of Object.entries(EXPECTED[kind]) as [keyof IWorkbenchColors, string][]) {
            it(`resolves "${key}" to ${hex} on the ${kind} default palette`, () => {
                expect(theme.getColor(key)).toBe(parseHexColor(hex));
            });
        }
    }

    it("leaves the toolbar and status bar borders unset, as upstream outside high contrast", () => {
        const theme = WorkbenchTheme.fromThemeFile({ type: "dark", colors: {} });
        expect(theme.getColor("debugToolBar.border")).toBeUndefined();
        expect(theme.getColor("statusBar.debuggingBorder")).toBeUndefined();
    });
});
