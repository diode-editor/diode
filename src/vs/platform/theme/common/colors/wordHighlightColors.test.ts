import { packRgb, packRgba } from "@tuidom/core/common/colorUtils";
import { describe, expect, it } from "vitest";

import { WorkbenchTheme } from "../workbenchTheme.ts";

const theme = (type: "dark" | "light", colors: Record<string, string> = {}): WorkbenchTheme =>
    WorkbenchTheme.fromThemeFile({ name: "t", type, colors });

describe("word highlight colors", () => {
    it("the write color: opaque approximations of upstream's over the editor background", () => {
        expect(theme("dark").getRequiredColor("editor.wordHighlightStrongBackground")).toBe(packRgb(0x08, 0x3d, 0x5b));
        expect(theme("light").getRequiredColor("editor.wordHighlightStrongBackground")).toBe(packRgb(0xc3, 0xd8, 0xe6));
    });

    it("a theme's read color carries over to textual occurrences, unless it sets its own", () => {
        const inherited = theme("dark", { "editor.wordHighlightBackground": "#102030" });
        expect(inherited.getRequiredColor("editor.wordHighlightTextBackground")).toBe(packRgb(0x10, 0x20, 0x30));

        const own = theme("dark", {
            "editor.wordHighlightBackground": "#102030",
            "editor.wordHighlightTextBackground": "#405060",
        });
        expect(own.getRequiredColor("editor.wordHighlightTextBackground")).toBe(packRgb(0x40, 0x50, 0x60));
    });

    it("the overview ruler: upstream's values", () => {
        const strong = theme("dark").getRequiredColor("editorOverviewRuler.wordHighlightStrongForeground");
        expect(strong).toBe(packRgba(0xc0, 0xa0, 0xc0, 0xcc));
        const text = theme("light").getRequiredColor("editorOverviewRuler.wordHighlightTextForeground");
        expect(text).toBe(packRgba(0xa0, 0xa0, 0xa0, 0xcc));
    });

    it("the textual ruler mark follows editorOverviewRuler.selectionHighlightForeground", () => {
        const custom = theme("dark", { "editorOverviewRuler.selectionHighlightForeground": "#102030" });
        expect(custom.getRequiredColor("editorOverviewRuler.wordHighlightTextForeground")).toBe(
            packRgb(0x10, 0x20, 0x30),
        );
    });

    it.each([
        "editor.wordHighlightBorder",
        "editor.wordHighlightStrongBorder",
        "editor.wordHighlightTextBorder",
    ] as const)("%s has no default: a terminal cell has no border", (key) => {
        expect(theme("dark").getColor(key)).toBeUndefined();
    });
});
