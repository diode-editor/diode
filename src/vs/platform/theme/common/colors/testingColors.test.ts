import { describe, expect, it } from "vitest";

import { parseHexColor } from "../colorUtils.ts";
import type { IThemeFile } from "../iThemeFile.ts";
import { WorkbenchTheme } from "../workbenchTheme.ts";

import type { IWorkbenchColors } from "./colorContributions.ts";

/** Upstream defaults (`contrib/testing/browser/theme.ts`), the references resolved on our palettes. */
const EXPECTED: Record<"dark" | "light", Partial<Record<keyof IWorkbenchColors, string>>> = {
    dark: {
        "testing.iconFailed": "#F88070",
        "testing.iconErrored": "#F88070",
        "testing.iconPassed": "#73C991",
        "testing.runAction": "#73C991",
        "testing.iconQueued": "#CCA700",
        "testing.iconUnset": "#848484",
        "testing.iconSkipped": "#848484",
        "testing.message.error.badgeBackground": "#F14C4C",
        "testing.message.error.badgeBorder": "#F14C4C",
        "testing.message.error.badgeForeground": "#333333",
        "testing.message.info.decorationForeground": "#D4D4D480",
    },
    light: {
        "testing.iconFailed": "#B01011",
        "testing.iconErrored": "#B01011",
        "testing.iconPassed": "#73C991",
        "testing.runAction": "#73C991",
        "testing.iconQueued": "#855F00",
        "testing.iconUnset": "#848484",
        "testing.iconSkipped": "#848484",
        "testing.message.error.badgeBackground": "#E51400",
        "testing.message.error.badgeBorder": "#E51400",
        "testing.message.error.badgeForeground": "#FFFFFF",
        "testing.message.info.decorationForeground": "#3B3B3B80",
    },
};

const KIND_TO_TYPE: Record<"dark" | "light", IThemeFile["type"]> = { dark: "dark", light: "light" };

describe("testing color defaults", () => {
    for (const kind of ["dark", "light"] as const) {
        const theme = WorkbenchTheme.fromThemeFile({ type: KIND_TO_TYPE[kind], colors: {} });

        for (const [key, hex] of Object.entries(EXPECTED[kind]) as [keyof IWorkbenchColors, string][]) {
            it(`resolves "${key}" to ${hex} on the ${kind} default palette`, () => {
                expect(theme.getColor(key)).toBe(parseHexColor(hex));
            });
        }
    }
});
