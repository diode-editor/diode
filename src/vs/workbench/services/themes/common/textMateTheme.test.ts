import { packRgb } from "@tuidom/core/common/colorUtils";
import { describe, expect, it } from "vitest";

import type { ITokenColorRule } from "../../../../platform/theme/common/iThemeFile.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";

import { createTextMateTheme, equalsTextMateTheme, normalizeColor } from "./textMateTheme.ts";

function themeWith(rules: ITokenColorRule[], colors: WorkbenchTheme["colors"] = {}): WorkbenchTheme {
    return new WorkbenchTheme("t", "dark", colors, { rules });
}

describe("createTextMateTheme", () => {
    it("the first rule has no scope and carries the editor text and background colors: ColorId 1 and 2", () => {
        const theme = createTextMateTheme(
            themeWith([], {
                "editor.foreground": packRgb(0xd4, 0xd4, 0xd4),
                "editor.background": packRgb(0x1e, 0x1e, 0x1e),
            }),
        );
        expect(theme.settings).toEqual([{ settings: { foreground: "#D4D4D4", background: "#1E1E1E" } }]);
        expect(theme.colorMap).toEqual(["", "#D4D4D4", "#1E1E1E"]);
    });

    it("no editor colors: the default rule goes without them", () => {
        const theme = createTextMateTheme(themeWith([]));
        expect(theme.settings).toEqual([{ settings: { foreground: undefined, background: undefined } }]);
        expect(theme.colorMap).toEqual([""]);
    });

    it("theme rules without scope are dropped: upstream has a single default", () => {
        const theme = createTextMateTheme(
            themeWith([
                { settings: { foreground: "#111111" } },
                { scope: "", settings: { foreground: "#222222" } },
                { scope: [], settings: { foreground: "#333333" } },
                { scope: "keyword", settings: { foreground: "#444444" } },
            ]),
        );
        expect(theme.settings.slice(1)).toEqual([
            { scope: "keyword", settings: { foreground: "#444444", background: undefined, fontStyle: undefined } },
        ]);
        expect(theme.colorMap).toEqual(["", "#444444"]);
    });

    it("a scope array and fontStyle pass as is, colors are normalized", () => {
        const theme = createTextMateTheme(
            themeWith([
                {
                    scope: ["comment", "string"],
                    settings: { foreground: "#abc", background: "#ffffffff", fontStyle: "italic bold" },
                },
            ]),
        );
        expect(theme.settings[1]).toEqual({
            scope: ["comment", "string"],
            settings: { foreground: "#AABBCC", background: "#FFFFFF", fontStyle: "italic bold" },
        });
    });

    it("colorMap holds rule colors in order (foreground, then background), without duplicates", () => {
        const theme = createTextMateTheme(
            themeWith(
                [
                    { scope: "a", settings: { foreground: "#ff0000", background: "#00ff00" } },
                    { scope: "b", settings: { foreground: "#00FF00" } },
                    { scope: "c", settings: { foreground: "#0000ff" } },
                    { scope: "d", settings: { foreground: "#CCCCCC" } },
                ],
                { "editor.foreground": packRgb(0xcc, 0xcc, 0xcc) },
            ),
        );
        expect(theme.colorMap).toEqual(["", "#CCCCCC", "#FF0000", "#00FF00", "#0000FF"]);
    });
});

describe("normalizeColor", () => {
    it("expands the short form and uppercases", () => {
        expect(normalizeColor("#abc")).toBe("#AABBCC");
        expect(normalizeColor("#abcd")).toBe("#AABBCCDD");
        expect(normalizeColor("#a1b2c3")).toBe("#A1B2C3");
    });

    it("strips an opaque FF alpha, keeps a translucent one", () => {
        expect(normalizeColor("#123456ff")).toBe("#123456");
        expect(normalizeColor("#fffff")).toBeUndefined();
        expect(normalizeColor("#12345680")).toBe("#12345680");
        expect(normalizeColor("#abcf")).toBe("#AABBCC");
    });

    it("invalid and missing give undefined", () => {
        expect(normalizeColor(undefined)).toBeUndefined();
        expect(normalizeColor("red")).toBeUndefined();
        expect(normalizeColor("123456")).toBeUndefined();
        expect(normalizeColor("#12345g")).toBeUndefined();
        expect(normalizeColor("#12")).toBeUndefined();
        expect(normalizeColor("#1234567")).toBeUndefined();
        expect(normalizeColor("x#123456")).toBeUndefined();
        expect(normalizeColor("#123456x")).toBeUndefined();
    });
});

describe("equalsTextMateTheme", () => {
    it("the same rules and colors are equal, even as different objects", () => {
        const rules: ITokenColorRule[] = [{ scope: "a", settings: { foreground: "#ff0000" } }];
        expect(equalsTextMateTheme(createTextMateTheme(themeWith(rules)), createTextMateTheme(themeWith(rules)))).toBe(
            true,
        );
    });

    it("no theme yet: not equal", () => {
        expect(equalsTextMateTheme(undefined, createTextMateTheme(themeWith([])))).toBe(false);
    });

    it("a different color: not equal", () => {
        const a = createTextMateTheme(themeWith([{ scope: "a", settings: { foreground: "#ff0000" } }]));
        const b = createTextMateTheme(themeWith([{ scope: "a", settings: { foreground: "#ff0001" } }]));
        expect(equalsTextMateTheme(a, b)).toBe(false);
    });
});
