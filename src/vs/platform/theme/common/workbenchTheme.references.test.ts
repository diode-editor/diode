import { packRgb } from "@tuidom/core/common/colorUtils";
import { describe, expect, it } from "vitest";

import { darkPlusTheme } from "../../../workbench/services/themes/common/themes/darkPlus.ts";

import { WorkbenchTheme } from "./workbenchTheme.ts";

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

    it("without theme values derived keys equal the baked VS Code defaults (Dark+ is unchanged)", () => {
        const bare = WorkbenchTheme.fromThemeFile({ name: "bare", type: "dark", colors: {} });
        expect(bare.getRequiredColor("quickInput.background")).toBe(packRgb(0x25, 0x25, 0x26));
        expect(bare.getRequiredColor("quickInput.foreground")).toBe(packRgb(0xcc, 0xcc, 0xcc));
        expect(bare.getRequiredColor("menu.background")).toBe(packRgb(0x3c, 0x3c, 0x3c));

        const darkPlus = WorkbenchTheme.fromThemeFile(darkPlusTheme);
        expect(darkPlus.getRequiredColor("quickInput.background")).toBe(packRgb(0x25, 0x25, 0x26));
        expect(darkPlus.getRequiredColor("menu.background")).toBe(packRgb(0x25, 0x25, 0x26));
    });

    it("a theme value that is neither hex nor a registry key is an error naming the referencing key", () => {
        expect(() =>
            WorkbenchTheme.fromThemeFile({ name: "bad", type: "dark", colors: { "editor.background": "red" } }),
        ).toThrow('Color "editor.background" refers to unknown color "red"');
        // Along a chain the last referring key is blamed, not the first.
        expect(() =>
            WorkbenchTheme.fromThemeFile({
                name: "bad-chain",
                type: "dark",
                colors: { "editor.background": "editor.foreground", "editor.foreground": "nope" },
            }),
        ).toThrow('Color "editor.foreground" refers to unknown color "nope"');
    });

    it("a reference cycle is an error with the full chain, not infinite recursion", () => {
        expect(() =>
            WorkbenchTheme.fromThemeFile({
                name: "cycle",
                type: "dark",
                colors: { "editor.background": "editor.foreground", "editor.foreground": "editor.background" },
            }),
        ).toThrow("Color reference cycle: editor.background → editor.foreground → editor.background");
    });
});
