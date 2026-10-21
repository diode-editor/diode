import { describe, expect, it } from "vitest";

import { parseHexColor } from "../colorUtils.ts";
import type { IThemeFile } from "../iThemeFile.ts";
import { WorkbenchTheme } from "../workbenchTheme.ts";

import type { IWorkbenchColors } from "./colorContributions.ts";

/** Ожидания — дефолты VS Code: editorGutter — реестр SCM quickDiff, gitDecoration — `contributes.colors` расширения git. */
const EXPECTED: Record<"dark" | "light", Partial<Record<keyof IWorkbenchColors, string>>> = {
    dark: {
        "editorGutter.modifiedBackground": "#1B81A8",
        "editorGutter.addedBackground": "#487E02",
        "editorGutter.deletedBackground": "#F14C4C",
        "gitDecoration.addedResourceForeground": "#81B88B",
        "gitDecoration.modifiedResourceForeground": "#E2C08D",
        "gitDecoration.deletedResourceForeground": "#C74E39",
        "gitDecoration.renamedResourceForeground": "#73C991",
        "gitDecoration.untrackedResourceForeground": "#73C991",
        "gitDecoration.ignoredResourceForeground": "#8C8C8C",
        "gitDecoration.conflictingResourceForeground": "#E4676B",
        "gitDecoration.submoduleResourceForeground": "#8DB9E2",
    },
    light: {
        "editorGutter.modifiedBackground": "#2090D3",
        "editorGutter.addedBackground": "#48985D",
        "editorGutter.deletedBackground": "#E51400",
        "gitDecoration.addedResourceForeground": "#587C0C",
        "gitDecoration.modifiedResourceForeground": "#895503",
        "gitDecoration.deletedResourceForeground": "#AD0707",
        "gitDecoration.renamedResourceForeground": "#007100",
        "gitDecoration.untrackedResourceForeground": "#007100",
        "gitDecoration.ignoredResourceForeground": "#8E8E90",
        "gitDecoration.conflictingResourceForeground": "#AD0707",
        "gitDecoration.submoduleResourceForeground": "#1258A7",
    },
};

const KIND_TO_TYPE: Record<"dark" | "light", IThemeFile["type"]> = { dark: "dark", light: "light" };

describe("git-diff decoration color defaults", () => {
    for (const kind of ["dark", "light"] as const) {
        // A bare theme (no color overrides) so getColor resolves purely from the registry.
        const theme = WorkbenchTheme.fromThemeFile({ type: KIND_TO_TYPE[kind], colors: {} });

        for (const [key, hex] of Object.entries(EXPECTED[kind]) as [keyof IWorkbenchColors, string][]) {
            it(`resolves "${key}" to ${hex} on the ${kind} default palette`, () => {
                expect(theme.getColor(key)).toBe(parseHexColor(hex));
            });
        }
    }
});
