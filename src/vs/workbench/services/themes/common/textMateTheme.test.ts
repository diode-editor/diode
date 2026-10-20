import { packRgb } from "@tuidom/core/common/colorUtils";
import { describe, expect, it } from "vitest";

import type { ITokenColorRule } from "../../../../platform/theme/common/iThemeFile.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";

import { createTextMateTheme, equalsTextMateTheme, normalizeColor } from "./textMateTheme.ts";

function themeWith(rules: ITokenColorRule[], colors: WorkbenchTheme["colors"] = {}): WorkbenchTheme {
    return new WorkbenchTheme("t", "dark", colors, { rules });
}

describe("createTextMateTheme", () => {
    it("первое правило — без скоупа, цвета текста и фона редактора: это ColorId 1 и 2", () => {
        const theme = createTextMateTheme(
            themeWith([], {
                "editor.foreground": packRgb(0xd4, 0xd4, 0xd4),
                "editor.background": packRgb(0x1e, 0x1e, 0x1e),
            }),
        );
        expect(theme.settings).toEqual([{ settings: { foreground: "#D4D4D4", background: "#1E1E1E" } }]);
        expect(theme.colorMap).toEqual(["", "#D4D4D4", "#1E1E1E"]);
    });

    it("нет цветов редактора — правило по умолчанию без них", () => {
        const theme = createTextMateTheme(themeWith([]));
        expect(theme.settings).toEqual([{ settings: { foreground: undefined, background: undefined } }]);
        expect(theme.colorMap).toEqual([""]);
    });

    it("правила темы без скоупа отбрасываются — умолчание у эталона одно", () => {
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

    it("скоуп-массив и fontStyle уходят как есть, цвета нормализуются", () => {
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

    it("colorMap — цвета правил по порядку (текст, затем фон), без повторов", () => {
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
    it("разворачивает короткую форму и поднимает регистр", () => {
        expect(normalizeColor("#abc")).toBe("#AABBCC");
        expect(normalizeColor("#abcd")).toBe("#AABBCCDD");
        expect(normalizeColor("#a1b2c3")).toBe("#A1B2C3");
    });

    it("снимает непрозрачную альфу FF, полупрозрачную оставляет", () => {
        expect(normalizeColor("#123456ff")).toBe("#123456");
        expect(normalizeColor("#fffff")).toBeUndefined();
        expect(normalizeColor("#12345680")).toBe("#12345680");
        expect(normalizeColor("#abcf")).toBe("#AABBCC");
    });

    it("невалидное и отсутствующее — undefined", () => {
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
    it("те же правила и цвета — равны, даже разными объектами", () => {
        const rules: ITokenColorRule[] = [{ scope: "a", settings: { foreground: "#ff0000" } }];
        expect(equalsTextMateTheme(createTextMateTheme(themeWith(rules)), createTextMateTheme(themeWith(rules)))).toBe(
            true,
        );
    });

    it("темы ещё не было — не равны", () => {
        expect(equalsTextMateTheme(undefined, createTextMateTheme(themeWith([])))).toBe(false);
    });

    it("другой цвет — не равны", () => {
        const a = createTextMateTheme(themeWith([{ scope: "a", settings: { foreground: "#ff0000" } }]));
        const b = createTextMateTheme(themeWith([{ scope: "a", settings: { foreground: "#ff0001" } }]));
        expect(equalsTextMateTheme(a, b)).toBe(false);
    });
});
