import { describe, expect, it } from "vitest";

import { packRgb } from "@tuidom/all/common/colorUtils";

import type { IThemeFile } from "./iThemeFile.ts";
import { WorkbenchTheme } from "./workbenchTheme.ts";

describe("WorkbenchTheme", () => {
    const sampleTheme: IThemeFile = {
        name: "Test Theme",
        type: "dark",
        colors: {
            "editor.background": "#1E1E1E",
            "editor.foreground": "#D4D4D4",
            "statusBar.background": "#007ACC",
            "statusBar.foreground": "#FFFFFF",
        },
        tokenColors: [
            {
                scope: "comment",
                settings: { foreground: "#6A9955" },
            },
        ],
    };

    it("creates from VS Code theme JSON", () => {
        const theme = WorkbenchTheme.fromThemeFile(sampleTheme);
        expect(theme.name).toBe("Test Theme");
        expect(theme.type).toBe("dark");
    });

    it("converts hex colors to packed RGB", () => {
        const theme = WorkbenchTheme.fromThemeFile(sampleTheme);
        expect(theme.colors["editor.background"]).toBe(packRgb(0x1e, 0x1e, 0x1e));
        expect(theme.colors["editor.foreground"]).toBe(packRgb(0xd4, 0xd4, 0xd4));
        expect(theme.colors["statusBar.background"]).toBe(packRgb(0x00, 0x7a, 0xcc));
        expect(theme.colors["statusBar.foreground"]).toBe(packRgb(0xff, 0xff, 0xff));
    });

    it("preserves token color rules", () => {
        const theme = WorkbenchTheme.fromThemeFile(sampleTheme);
        expect(theme.tokenTheme.rules).toHaveLength(1);
        expect(theme.tokenTheme.rules[0].scope).toBe("comment");
        expect(theme.tokenTheme.rules[0].settings.foreground).toBe("#6A9955");
    });

    it("getColor returns color when defined", () => {
        const theme = WorkbenchTheme.fromThemeFile(sampleTheme);
        expect(theme.getColor("editor.background")).toBe(packRgb(0x1e, 0x1e, 0x1e));
    });

    it("getColor returns undefined for a key absent from theme and default registry", () => {
        const theme = WorkbenchTheme.fromThemeFile(sampleTheme);
        // editorGutter.background has no registry default (genuinely optional).
        expect(theme.getColor("editorGutter.background")).toBeUndefined();
    });

    it("layers the default color registry under the theme's own colors", () => {
        // sampleTheme does not define list.hoverBackground; the dark default fills it.
        const theme = WorkbenchTheme.fromThemeFile(sampleTheme);
        expect(theme.getColor("list.hoverBackground")).toBe(packRgb(0x2a, 0x2d, 0x2e));
    });

    it("lets the theme's own color win over the default registry", () => {
        const theme = WorkbenchTheme.fromThemeFile({
            type: "dark",
            colors: { "list.hoverBackground": "#123456" },
        });
        expect(theme.getColor("list.hoverBackground")).toBe(packRgb(0x12, 0x34, 0x56));
    });

    it("applies light defaults for light themes", () => {
        const theme = WorkbenchTheme.fromThemeFile({ type: "light", colors: {} });
        expect(theme.getColor("list.hoverBackground")).toBe(packRgb(0xf2, 0xf2, 0xf2));
    });

    it("getRequiredColor returns color when defined", () => {
        const theme = WorkbenchTheme.fromThemeFile(sampleTheme);
        expect(theme.getRequiredColor("editor.background")).toBe(packRgb(0x1e, 0x1e, 0x1e));
    });

    it("getRequiredColor resolves from the default registry when the theme omits the key", () => {
        // sampleTheme omits sideBar.background; the dark default (#252526) resolves it.
        const theme = WorkbenchTheme.fromThemeFile(sampleTheme);
        expect(theme.getRequiredColor("sideBar.background")).toBe(packRgb(0x25, 0x25, 0x26));
    });

    it("getRequiredColor throws for a key absent from theme and registry", () => {
        const theme = WorkbenchTheme.fromThemeFile(sampleTheme);
        expect(() => theme.getRequiredColor("editorGutter.background")).toThrow(/editorGutter\.background/);
    });

    it("defaults to 'dark' type and 'Unnamed' when not specified", () => {
        const theme = WorkbenchTheme.fromThemeFile({ colors: {} });
        expect(theme.name).toBe("Unnamed");
        expect(theme.type).toBe("dark");
    });

    it("defaults to empty tokenColors when not specified", () => {
        const theme = WorkbenchTheme.fromThemeFile({ colors: {} });
        expect(theme.tokenTheme.rules).toEqual([]);
    });
});
