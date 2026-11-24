import { describe, expect, it } from "vitest";

import { colorCustomizationProblems, colorCustomizationsForTheme } from "./colorCustomizations.ts";

describe("colorCustomizationsForTheme", () => {
    it("takes the global entries for any theme", () => {
        expect(colorCustomizationsForTheme({ "editor.background": "#202020" }, "Dark Modern")).toEqual({
            "editor.background": "#202020",
        });
    });

    it("a block naming the theme goes over the global entries; a block for another theme does nothing", () => {
        const setting = {
            "editor.background": "#202020",
            "editor.foreground": "#eeeeee",
            "[Light Modern]": { "editor.background": "#fff8e0" },
            "[Monokai]": { "editor.foreground": "#123456" },
        };
        expect(colorCustomizationsForTheme(setting, "Light Modern")).toEqual({
            "editor.background": "#fff8e0",
            "editor.foreground": "#eeeeee",
        });
        expect(colorCustomizationsForTheme(setting, "Dark Modern")).toEqual({
            "editor.background": "#202020",
            "editor.foreground": "#eeeeee",
        });
    });

    it("[A][B] names several themes", () => {
        const setting = { "[Monokai][Light Modern]": { "editor.background": "#010203" } };
        expect(colorCustomizationsForTheme(setting, "Monokai")).toEqual({ "editor.background": "#010203" });
        expect(colorCustomizationsForTheme(setting, "Light Modern")).toEqual({ "editor.background": "#010203" });
        expect(colorCustomizationsForTheme(setting, "Dark Modern")).toEqual({});
    });

    it.each([
        ["*Modern", "Light Modern", true],
        ["*Modern", "Modern Light", false],
        ["Light*", "Light Modern", true],
        ["Light*", "Dark Light", false],
        ["*ght Mo*", "Light Modern", true],
        ["*ght Mo*", "Dark Modern", false],
        ["*", "Anything", true],
        ["Light", "Light Modern", false],
    ])("[%s] matches %s: %s", (scope, themeId, matches) => {
        const result = colorCustomizationsForTheme({ [`[${scope}]`]: { "editor.background": "#010203" } }, themeId);
        expect(result).toEqual(matches ? { "editor.background": "#010203" } : {});
    });

    it("a later matching block wins over an earlier one", () => {
        const setting = {
            "[*Modern]": { "editor.background": "#111111", "editor.foreground": "#222222" },
            "[Light*]": { "editor.background": "#333333" },
        };
        expect(colorCustomizationsForTheme(setting, "Light Modern")).toEqual({
            "editor.background": "#333333",
            "editor.foreground": "#222222",
        });
    });

    it("keeps hex with alpha and the 'default' keyword, drops everything else", () => {
        const setting = {
            "a.short": "#abc",
            "a.shortAlpha": "#abcd",
            "a.alpha": "#11223344",
            "a.default": "default",
            "b.reference": "editor.foreground",
            "b.noHash": "202020",
            "b.badHex": "#12345",
            "b.number": 42,
            "b.null": null,
            "[Dark Modern]": { "c.ok": "#010203", "c.bad": "red" },
        };
        expect(colorCustomizationsForTheme(setting, "Dark Modern")).toEqual({
            "a.short": "#abc",
            "a.shortAlpha": "#abcd",
            "a.alpha": "#11223344",
            "a.default": "default",
            "c.ok": "#010203",
        });
    });

    it("a theme block that is not an object is ignored", () => {
        expect(colorCustomizationsForTheme({ "[Dark Modern]": "#010203" }, "Dark Modern")).toEqual({});
        expect(colorCustomizationsForTheme({ "[Dark Modern]": ["#010203"] }, "Dark Modern")).toEqual({});
    });

    it("a setting that is not an object gives nothing", () => {
        expect(colorCustomizationsForTheme(undefined, "Dark Modern")).toEqual({});
        expect(colorCustomizationsForTheme("#202020", "Dark Modern")).toEqual({});
    });
});

describe("colorCustomizationProblems", () => {
    it("names every skipped entry, in blocks of inactive themes too", () => {
        expect(
            colorCustomizationProblems({
                "editor.background": "#202020",
                "editor.foreground": "editor.background",
                "[Monokai]": { "editor.background": 7, "editor.foreground": "default" },
                "[Light Modern]": "#fff8e0",
            }),
        ).toEqual([
            'workbench.colorCustomizations: "editor.foreground" must be a hex color (#RGB, #RGBA, #RRGGBB, #RRGGBBAA) or "default", got "editor.background"; skipped',
            'workbench.colorCustomizations: [Monokai] "editor.background" must be a hex color (#RGB, #RGBA, #RRGGBB, #RRGGBBAA) or "default", got 7; skipped',
            'workbench.colorCustomizations: "[Light Modern]" must be an object of colors for the themes it names',
        ]);
    });

    it("a nested theme block inside a theme block is an invalid value", () => {
        expect(colorCustomizationProblems({ "[A]": { "[B]": { x: "#000" } } })).toEqual([
            'workbench.colorCustomizations: [A] "[B]" must be a hex color (#RGB, #RGBA, #RRGGBB, #RRGGBBAA) or "default", got {"x":"#000"}; skipped',
        ]);
    });

    it("nothing to report for a valid or absent setting", () => {
        expect(colorCustomizationProblems({ "editor.background": "#202020", "[A]": { x: "default" } })).toEqual([]);
        expect(colorCustomizationProblems(undefined)).toEqual([]);
    });
});
