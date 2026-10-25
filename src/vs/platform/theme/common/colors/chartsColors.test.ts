import { describe, expect, it } from "vitest";

import { parseHexColor } from "../colorUtils.ts";
import type { IThemeFile } from "../iThemeFile.ts";
import { WorkbenchTheme } from "../workbenchTheme.ts";

import type { IWorkbenchColors } from "./colorContributions.ts";

/**
 * vscode defaults (`chartsColors.ts`). Extensions color tree icons with them (`new ThemeIcon("x", new
 * ThemeColor("charts.red"))`); a token the theme doesn't know leaves the icon in the row's color.
 */
const EXPECTED: Record<"dark" | "light", Record<string, string>> = {
    dark: {
        "charts.red": "#F14C4C",
        "charts.blue": "#59A4F9",
        "charts.yellow": "#CCA700",
        "charts.green": "#89D185",
        "charts.purple": "#B180D7",
    },
    light: {
        "charts.red": "#E51400",
        "charts.blue": "#0063D3",
        "charts.yellow": "#BF8803",
        "charts.green": "#388A34",
        "charts.purple": "#652D90",
    },
};

const KIND_TO_TYPE: Record<"dark" | "light", IThemeFile["type"]> = { dark: "dark", light: "light" };

describe("charts color defaults", () => {
    for (const kind of ["dark", "light"] as const) {
        const theme = WorkbenchTheme.fromThemeFile({ type: KIND_TO_TYPE[kind], colors: {} });

        for (const [key, hex] of Object.entries(EXPECTED[kind])) {
            it(`resolves "${key}" to ${hex} on the ${kind} default palette`, () => {
                expect(theme.getColor(key as keyof IWorkbenchColors)).toBe(parseHexColor(hex));
            });
        }
    }
});
