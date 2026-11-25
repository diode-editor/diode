import { packRgb, packRgba } from "@tuidom/core/common/colorUtils";
import { describe, expect, it } from "vitest";

import type { IThemeFile } from "./iThemeFile.ts";
import { WorkbenchTheme } from "./workbenchTheme.ts";

const DARK: IThemeFile = { name: "Dark", type: "dark", colors: { "editor.background": "#1f1f1f" } };

/** `workbench.colorCustomizations` as the third layer: registry default → theme → customization. */
describe("WorkbenchTheme.fromThemeFile: custom colors", () => {
    it("a custom hex wins over the theme's color", () => {
        const theme = WorkbenchTheme.fromThemeFile(DARK, {}, { "editor.background": "#202020" });
        expect(theme.getRequiredColor("editor.background")).toBe(packRgb(0x20, 0x20, 0x20));
    });

    it("keeps alpha, as theme colors do", () => {
        const theme = WorkbenchTheme.fromThemeFile(DARK, {}, { "editor.background": "#20202080" });
        expect(theme.getRequiredColor("editor.background")).toBe(packRgba(0x20, 0x20, 0x20, 0x80));
    });

    it("overrides a registry default the theme leaves unset", () => {
        const theme = WorkbenchTheme.fromThemeFile(DARK, {}, { "editor.foreground": "#abcdef" });
        expect(theme.getRequiredColor("editor.foreground")).toBe(packRgb(0xab, 0xcd, 0xef));
    });

    it("'default' drops the theme's color back to the registry default of the theme kind", () => {
        const theme = WorkbenchTheme.fromThemeFile(DARK, {}, { "editor.background": "default" });
        expect(theme.getRequiredColor("editor.background")).toBe(packRgb(0x1e, 0x1e, 0x1e));
        const light = WorkbenchTheme.fromThemeFile(
            { name: "Light", type: "light", colors: { "editor.background": "#fafafa" } },
            {},
            { "editor.background": "default" },
        );
        expect(light.getRequiredColor("editor.background")).toBe(packRgb(0xff, 0xff, 0xff));
    });

    it("'default' on a key without a registry default leaves the color unset", () => {
        const theme = WorkbenchTheme.fromThemeFile(
            { name: "Dark", type: "dark", colors: { "my.color": "#123456" } },
            {},
            { "my.color": "default" },
        );
        expect(theme.colors).not.toHaveProperty("my.color");
    });

    it("a color derived by reference follows the customized base", () => {
        // editorSuggestWidget.foreground → editor.foreground in the registry.
        const theme = WorkbenchTheme.fromThemeFile(DARK, {}, { "editor.foreground": "#abcdef" });
        expect(theme.getRequiredColor("editorSuggestWidget.foreground")).toBe(packRgb(0xab, 0xcd, 0xef));
    });

    it("customizes an extension's contributed color, and 'default' returns its own default", () => {
        const extensionColors = {
            "myExt.warning": { defaults: { dark: "#ff0000", light: "#00ff00" }, description: "" },
        };
        const custom = WorkbenchTheme.fromThemeFile(DARK, extensionColors, { "myExt.warning": "#0000ff" });
        expect(custom.colors["myExt.warning" as keyof typeof custom.colors]).toBe(packRgb(0, 0, 0xff));

        const reset = WorkbenchTheme.fromThemeFile(
            { name: "Dark", type: "dark", colors: { "myExt.warning": "#111111" } },
            extensionColors,
            { "myExt.warning": "default" },
        );
        expect(reset.colors["myExt.warning" as keyof typeof reset.colors]).toBe(packRgb(0xff, 0, 0));
    });

    it("a key nobody consumes is accepted without an error", () => {
        expect(() => WorkbenchTheme.fromThemeFile(DARK, {}, { "nobody.uses": "#010203" })).not.toThrow();
    });
});
