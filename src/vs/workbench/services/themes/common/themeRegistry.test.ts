import { describe, expect, it } from "vitest";

import type { IThemeFile } from "../../../../platform/theme/common/iThemeFile.ts";

import { createBuiltinThemeRegistry, ThemeRegistry } from "./themeRegistry.ts";
import { builtinThemes, DEFAULT_COLOR_THEME } from "./themes/builtinThemes.ts";

const A: IThemeFile = { name: "Theme A", type: "dark", colors: { "editor.background": "#111111" }, tokenColors: [] };
const B: IThemeFile = { name: "Theme B", type: "light", colors: { "editor.background": "#eeeeee" }, tokenColors: [] };

describe("ThemeRegistry", () => {
    it("looks up registered themes by label", () => {
        const registry = new ThemeRegistry([A, B]);
        expect(registry.has("Theme A")).toBe(true);
        expect(registry.has("Nope")).toBe(false);
        expect(registry.getThemeFile("Theme B")).toBe(B);
    });

    it("resolves a label into a WorkbenchTheme (hex → packed RGB)", () => {
        const registry = new ThemeRegistry([A]);
        const theme = registry.resolve("Theme A");
        expect(theme?.name).toBe("Theme A");
        // #111111 packed → non-undefined color value.
        expect(theme?.getColor("editor.background")).toBeDefined();
        expect(registry.resolve("Missing")).toBeUndefined();
    });

    it("lists descriptors with label + base type", () => {
        const registry = new ThemeRegistry([A, B]);
        expect(registry.list()).toEqual([
            { label: "Theme A", type: "dark" },
            { label: "Theme B", type: "light" },
        ]);
    });

    it("a later registration with the same name shadows the earlier one", () => {
        const registry = new ThemeRegistry([A]);
        const shadow: IThemeFile = { ...A, colors: { "editor.background": "#222222" } };
        registry.register(shadow);
        expect(registry.getThemeFile("Theme A")).toBe(shadow);
        expect(registry.list()).toHaveLength(1);
    });

    it("unregister removes a theme by label and reports whether it was there", () => {
        const registry = new ThemeRegistry([A, B]);
        expect(registry.unregister("Theme A")).toBe(true);
        expect(registry.has("Theme A")).toBe(false);
        expect(registry.list()).toEqual([{ label: "Theme B", type: "light" }]);
        expect(registry.unregister("Theme A")).toBe(false);
    });

    it("ignores themes without a name", () => {
        const registry = new ThemeRegistry();
        registry.register({ type: "dark", colors: {}, tokenColors: [] } as IThemeFile);
        expect(registry.list()).toHaveLength(0);
    });

    it("defaults a descriptor's type to 'dark' when the theme file omits type", () => {
        const registry = new ThemeRegistry([{ name: "Typeless", colors: {} } as IThemeFile]);
        expect(registry.list()).toEqual([{ label: "Typeless", type: "dark" }]);
    });
});

describe("built-in themes", () => {
    it("every built-in theme resolves without throwing (well-formed generated files)", () => {
        const registry = createBuiltinThemeRegistry();
        for (const file of builtinThemes) {
            const theme = registry.resolve(file.name!);
            expect(theme, `theme "${file.name}" should resolve`).toBeDefined();
            // A real editor background parses to a packed color for every theme.
            expect(theme!.getColor("editor.background")).toBeDefined();
            expect(theme!.tokenTheme.rules.length).toBeGreaterThan(0);
        }
    });

    it("the default color theme is registered", () => {
        const registry = createBuiltinThemeRegistry();
        expect(registry.has(DEFAULT_COLOR_THEME)).toBe(true);
        expect(registry.resolve(DEFAULT_COLOR_THEME)?.name).toBe(DEFAULT_COLOR_THEME);
    });
});
