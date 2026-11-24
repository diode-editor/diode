import { packRgb } from "@tuidom/core/common/colorUtils";
import { describe, expect, it } from "vitest";

import { darkPlusTheme } from "../../../workbench/services/themes/common/themes/darkPlus.ts";

import { parseHexColor } from "./colorUtils.ts";
import { followReference, WorkbenchTheme } from "./workbenchTheme.ts";

/** Modeled on Catppuccin: `editorWidget.background` is set (#181825), `quickInput.background` isn't. */
describe("WorkbenchTheme: derived defaults by reference", () => {
    it("a derived key follows its base key from the theme", () => {
        const theme = WorkbenchTheme.fromThemeFile({
            name: "mocha-like",
            type: "dark",
            colors: { "editorWidget.background": "#181825", "editorWidget.foreground": "#CDD6F4" },
        });

        expect(theme.getRequiredColor("quickInput.background")).toBe(packRgb(0x18, 0x18, 0x25));
        expect(theme.getRequiredColor("quickInput.foreground")).toBe(packRgb(0xcd, 0xd6, 0xf4));
        expect(theme.getRequiredColor("editorHoverWidget.background")).toBe(packRgb(0x18, 0x18, 0x25));
        expect(theme.getRequiredColor("notifications.background")).toBe(packRgb(0x18, 0x18, 0x25));
    });

    it("an explicit theme value for a derived key wins over the reference", () => {
        const theme = WorkbenchTheme.fromThemeFile({
            name: "explicit",
            type: "dark",
            colors: { "editorWidget.background": "#181825", "quickInput.background": "#222222" },
        });

        expect(theme.getRequiredColor("quickInput.background")).toBe(packRgb(0x22, 0x22, 0x22));
        expect(theme.getRequiredColor("editorHoverWidget.background")).toBe(packRgb(0x18, 0x18, 0x25));
    });

    it("reference chain: menu.selectionBackground → list.activeSelectionBackground → theme", () => {
        const theme = WorkbenchTheme.fromThemeFile({
            name: "chain",
            type: "light",
            colors: { "list.activeSelectionBackground": "#E8E8E8", foreground: "#101010" },
        });

        expect(theme.getRequiredColor("menu.selectionBackground")).toBe(packRgb(0xe8, 0xe8, 0xe8));
        // editorWidget.foreground → foreground → theme; dropdown.foreground (light) → foreground.
        expect(theme.getRequiredColor("editorWidget.foreground")).toBe(packRgb(0x10, 0x10, 0x10));
        expect(theme.getRequiredColor("menu.foreground")).toBe(packRgb(0x10, 0x10, 0x10));
    });

    it("indent guide chain: background1 → editorIndentGuide.background → editorWhitespace.foreground", () => {
        const monokaiLike = WorkbenchTheme.fromThemeFile({
            name: "monokai-like",
            type: "dark",
            colors: { "editorIndentGuide.background": "#464741", "editorIndentGuide.activeBackground": "#767771" },
        });
        expect(monokaiLike.getRequiredColor("editorIndentGuide.background1")).toBe(packRgb(0x46, 0x47, 0x41));
        expect(monokaiLike.getRequiredColor("editorIndentGuide.activeBackground1")).toBe(packRgb(0x76, 0x77, 0x71));

        const whitespaceOnly = WorkbenchTheme.fromThemeFile({
            name: "whitespace-only",
            type: "light",
            colors: { "editorWhitespace.foreground": "#123456" },
        });
        expect(whitespaceOnly.getRequiredColor("editorIndentGuide.background1")).toBe(packRgb(0x12, 0x34, 0x56));
        expect(whitespaceOnly.getRequiredColor("editorIndentGuide.activeBackground1")).toBe(packRgb(0x12, 0x34, 0x56));

        // An explicit background1 (Dark+) wins over the deprecated key.
        const darkPlus = WorkbenchTheme.fromThemeFile(darkPlusTheme);
        expect(darkPlus.getRequiredColor("editorIndentGuide.background1")).toBe(packRgb(0x40, 0x40, 0x40));
        expect(darkPlus.getRequiredColor("editorIndentGuide.activeBackground1")).toBe(packRgb(0x70, 0x70, 0x70));
    });

    it("bare themes get VS Code's editorWhitespace.foreground defaults for guides", () => {
        const dark = WorkbenchTheme.fromThemeFile({ name: "bare", type: "dark", colors: {} });
        const light = WorkbenchTheme.fromThemeFile({ name: "bare", type: "light", colors: {} });
        expect(dark.getRequiredColor("editorIndentGuide.background1")).toBe(parseHexColor("#e3e4e229"));
        expect(light.getRequiredColor("editorIndentGuide.activeBackground1")).toBe(parseHexColor("#33333333"));
    });

    it("without theme values derived keys equal the baked VS Code defaults (Dark+ is unchanged)", () => {
        const bare = WorkbenchTheme.fromThemeFile({ name: "bare", type: "dark", colors: {} });
        expect(bare.getRequiredColor("quickInput.background")).toBe(packRgb(0x25, 0x25, 0x26));
        expect(bare.getRequiredColor("quickInput.foreground")).toBe(packRgb(0xcc, 0xcc, 0xcc));
        expect(bare.getRequiredColor("menu.background")).toBe(packRgb(0x3c, 0x3c, 0x3c));

        const darkPlus = WorkbenchTheme.fromThemeFile(darkPlusTheme);
        expect(darkPlus.getRequiredColor("quickInput.background")).toBe(packRgb(0x25, 0x25, 0x26));
        expect(darkPlus.getRequiredColor("menu.background")).toBe(packRgb(0x25, 0x25, 0x26));
    });

    it("a value that is neither hex nor a registry key leaves the color unset, the rest resolves", () => {
        const theme = WorkbenchTheme.fromThemeFile({
            name: "bad",
            type: "dark",
            colors: { "editor.background": "red", "editor.foreground": "#123456" },
        });
        expect(theme.getColor("editor.background")).toBeUndefined();
        expect(theme.getColor("editor.foreground")).toBe(packRgb(0x12, 0x34, 0x56));
    });

    it("a reference cycle leaves the colors unset, not infinite recursion", () => {
        const theme = WorkbenchTheme.fromThemeFile({
            name: "cycle",
            type: "dark",
            colors: { "editor.background": "editor.foreground", "editor.foreground": "editor.background" },
        });
        expect(theme.getColor("editor.background")).toBeUndefined();
        expect(theme.getColor("editor.foreground")).toBeUndefined();
    });
});

describe("followReference", () => {
    it("names the last referring key of a chain to an unknown key", () => {
        expect(followReference({ a: "unknown" }, "a")).toEqual({
            problem: 'Color "a" refers to unknown color "unknown"',
        });
        expect(followReference({ a: "b", b: "nope" }, "a")).toEqual({
            problem: 'Color "b" refers to unknown color "nope"',
        });
    });

    it("names the full chain of a cycle", () => {
        expect(followReference({ a: "b", b: "a" }, "a")).toEqual({ problem: "Color reference cycle: a → b → a" });
    });

    it("follows a chain to its hex value", () => {
        expect(followReference({ a: "b", b: "#010203" }, "a")).toEqual({ value: "#010203" });
    });
});
