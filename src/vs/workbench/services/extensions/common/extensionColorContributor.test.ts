import { packRgb, packRgba } from "@tuidom/core/common/colorUtils";
import { describe, expect, it } from "vitest";

import { createLoggerSpy } from "../../../../../TestUtils/themeExtensionFixture.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { IExtensionContributions } from "../../../../platform/extensions/common/iExtensionManifest.ts";
import type { IWorkbenchColors } from "../../../../platform/theme/common/colors/colorContributions.ts";
import type { IThemeFile } from "../../../../platform/theme/common/iThemeFile.ts";
import { ThemeRegistry } from "../../themes/common/themeRegistry.ts";

import { registerExtensionColors } from "./extensionColorContributor.ts";

function ext(colors: unknown, id = "test.colors"): IExtension {
    const contributes: IExtensionContributions | undefined = colors === undefined ? undefined : { colors };
    return {
        id,
        manifest: { name: "colors", publisher: "test", version: "0.0.1", engines: { vscode: "*" }, contributes },
        location: `UserExtensions/${id}-0.0.1/`,
        isBuiltin: false,
    };
}

const THEMES: IThemeFile[] = [
    { name: "Dark", type: "dark", colors: { "editor.background": "#101010" } },
    { name: "Light", type: "light", colors: { "editor.background": "#f0f0f0" } },
    { name: "HC", type: "hc", colors: {} },
    { name: "HC Light", type: "hcLight", colors: {} },
    { name: "Overrides", type: "dark", colors: { "my.color": "#123456" } },
];

function setup(extensions: readonly IExtension[]) {
    const registry = new ThemeRegistry(THEMES);
    const logger = createLoggerSpy();
    registerExtensionColors(extensions, registry, logger);
    const color = (theme: string, id: string): number | undefined =>
        registry.resolve(theme)?.getColor(id as keyof IWorkbenchColors);
    return { color, logger };
}

const color = (id: string, dark: string, light: string, extra: Record<string, unknown> = {}) => ({
    id,
    description: `${id} description`,
    defaults: { dark, light, ...extra },
});

describe("registerExtensionColors", () => {
    it("resolves a hex default by theme kind: hc takes dark, hcLight takes light", () => {
        const { color: get, logger } = setup([
            ext([color("my.color", "#ff0000", "#00ff00", { highContrast: "#0000ff" })]),
        ]);
        expect(get("Dark", "my.color")).toBe(packRgb(255, 0, 0));
        expect(get("Light", "my.color")).toBe(packRgb(0, 255, 0));
        expect(get("HC", "my.color")).toBe(packRgb(255, 0, 0));
        expect(get("HC Light", "my.color")).toBe(packRgb(0, 255, 0));
        expect(logger.warn).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
    });

    it("keeps the alpha of #rrggbbaa and #rgba", () => {
        const { color: get } = setup([ext([color("my.color", "#e454541b", "#f00a")])]);
        expect(get("Dark", "my.color")).toBe(packRgba(0xe4, 0x54, 0x54, 0x1b));
        expect(get("Light", "my.color")).toBe(packRgba(0xff, 0, 0, 0xaa));
    });

    it("a theme value for the id wins over the extension default", () => {
        const { color: get } = setup([ext([color("my.color", "#ff0000", "#00ff00")])]);
        expect(get("Overrides", "my.color")).toBe(packRgb(0x12, 0x34, 0x56));
    });

    it("follows references to a built-in id, to its own id and to another extension's id", () => {
        const { color: get, logger } = setup([
            ext([color("a.bg", "editor.background", "editor.background"), color("a.alias", "b.base", "a.bg")], "a.ext"),
            ext([color("b.base", "#abcdef", "#000000")], "b.ext"),
        ]);
        expect(get("Dark", "a.bg")).toBe(packRgb(0x10, 0x10, 0x10));
        expect(get("Light", "a.bg")).toBe(packRgb(0xf0, 0xf0, 0xf0));
        expect(get("Dark", "a.alias")).toBe(packRgb(0xab, 0xcd, 0xef));
        expect(get("Light", "a.alias")).toBe(packRgb(0xf0, 0xf0, 0xf0));
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it("a cycle or an unknown target leaves the color unset with one warning, the rest of the theme resolves", () => {
        const { color: get, logger } = setup([
            ext([
                color("c.one", "c.two", "c.two"),
                color("c.two", "c.one", "c.one"),
                color("c.lost", "no.such.color", "#ffffff"),
                color("c.fine", "#010203", "#010203"),
            ]),
        ]);
        expect(get("Dark", "c.one")).toBeUndefined();
        expect(get("Dark", "c.two")).toBeUndefined();
        expect(get("Dark", "c.lost")).toBeUndefined();
        expect(get("Light", "c.lost")).toBe(packRgb(255, 255, 255));
        expect(get("Dark", "c.fine")).toBe(packRgb(1, 2, 3));
        expect(get("Dark", "editor.background")).toBe(packRgb(0x10, 0x10, 0x10));
        expect(logger.warn.mock.calls.map(([message]) => message as string)).toEqual([
            'test.colors: color "c.one" is left unset — Color reference cycle: c.one → c.two → c.one',
            'test.colors: color "c.two" is left unset — Color reference cycle: c.two → c.one → c.two',
            'test.colors: color "c.lost" is left unset — Color "c.lost" refers to unknown color "no.such.color"',
        ]);
    });

    it("stops the extension's entries at the first invalid one; other extensions still register", () => {
        const { color: get, logger } = setup([
            ext([color("x.before", "#111111", "#111111"), { id: "x.bad" }, color("x.after", "#222222", "#222222")]),
            ext([color("y.other", "#333333", "#333333")], "y.ext"),
        ]);
        expect(get("Dark", "x.before")).toBe(packRgb(0x11, 0x11, 0x11));
        expect(get("Dark", "x.after")).toBeUndefined();
        expect(get("Dark", "y.other")).toBe(packRgb(0x33, 0x33, 0x33));
        expect(logger.error).toHaveBeenCalledExactlyOnceWith(
            "test.colors: 'configuration.colors.description' must be defined and can not be empty",
        );
    });

    it.each([
        [null, "'configuration.colors.id' must be defined and can not be empty"],
        [{ id: "", description: "d" }, "'configuration.colors.id' must be defined and can not be empty"],
        [{ id: 42, description: "d" }, "'configuration.colors.id' must be defined and can not be empty"],
        [
            { id: ".dot", description: "d" },
            "'configuration.colors.id' must only contain letters, digits and dots and can not start with a dot",
        ],
        [
            { id: "has-dash", description: "d" },
            "'configuration.colors.id' must only contain letters, digits and dots and can not start with a dot",
        ],
        [
            { id: "ok", description: "d" },
            "'configuration.colors.defaults' must be defined and must contain 'light' and 'dark'",
        ],
        [
            { id: "ok", description: "d", defaults: { dark: "#000000" } },
            "'configuration.colors.defaults' must be defined and must contain 'light' and 'dark'",
        ],
        [
            { id: "ok", description: "d", defaults: { light: "#000000" } },
            "'configuration.colors.defaults' must be defined and must contain 'light' and 'dark'",
        ],
        [
            { id: "ok", description: "d", defaults: [] },
            "'configuration.colors.defaults' must be defined and must contain 'light' and 'dark'",
        ],
        [
            color("ok", "#000000", "#000000", { highContrast: 1 }),
            "If defined, 'configuration.colors.defaults.highContrast' must be a string.",
        ],
        [
            color("ok", "#000000", "#000000", { highContrastLight: false }),
            "If defined, 'configuration.colors.defaults.highContrastLight' must be a string.",
        ],
    ])("rejects %j with the upstream message", (entry, message) => {
        const { color: get, logger } = setup([ext([entry, color("next", "#000000", "#000000")])]);
        expect(logger.error).toHaveBeenCalledExactlyOnceWith(`test.colors: ${message}`);
        expect(get("Dark", "next")).toBeUndefined();
    });

    it.each([
        ["dark", color("v.bad", "", "#000000")],
        ["dark", color("v.bad", "#12", "#000000")],
        ["light", color("v.bad", "#000000", "#zzzzzz")],
    ])("skips an entry whose %s value is neither hex nor a reference, and goes on", (slot, entry) => {
        const { color: get, logger } = setup([ext([entry, color("v.next", "#444444", "#444444")])]);
        expect(get("Dark", "v.bad")).toBeUndefined();
        expect(get("Dark", "v.next")).toBe(packRgb(0x44, 0x44, 0x44));
        expect(logger.error).toHaveBeenCalledExactlyOnceWith(
            `test.colors: configuration.colors.defaults.${slot} must be either a color value in hex (#RRGGBB[AA] or #RGB[A]) or the identifier of a themable color which provides the default.`,
        );
    });

    it("rejects a non-array contribution", () => {
        const { logger } = setup([ext({ id: "my.color" })]);
        expect(logger.error).toHaveBeenCalledExactlyOnceWith("test.colors: 'configuration.colors' must be a array");
    });

    it("ignores an extension without contributes or without colors", () => {
        const { logger } = setup([ext(undefined)]);
        expect(logger.error).not.toHaveBeenCalled();
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it("a built-in id stays built-in", () => {
        const { color: get, logger } = setup([ext([color("editor.background", "#ff0000", "#ff0000")])]);
        expect(get("Dark", "editor.background")).toBe(packRgb(0x10, 0x10, 0x10));
        expect(get("HC", "editor.background")).not.toBe(packRgb(255, 0, 0));
        expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
            'test.colors: color "editor.background" is a built-in color — the contribution is ignored',
        );
    });

    it("between two extensions the first in load order wins", () => {
        const { color: get, logger } = setup([
            ext([color("dup.color", "#111111", "#111111")], "first.ext"),
            ext([color("dup.color", "#222222", "#222222")], "second.ext"),
        ]);
        expect(get("Dark", "dup.color")).toBe(packRgb(0x11, 0x11, 0x11));
        expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
            'second.ext: color "dup.color" is already contributed by first.ext — the contribution is ignored',
        );
    });
});
