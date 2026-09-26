import { packRgb, packRgba, TRANSPARENT_COLOR } from "@tuidom/core/common/colorUtils";
import { describe, expect, it } from "vitest";

import { isHexColor, parseHexColor } from "./colorUtils.ts";

describe("parseHexColor", () => {
    it("parses #RRGGBB", () => {
        expect(parseHexColor("#1E1E1E")).toBe(packRgb(0x1e, 0x1e, 0x1e));
        expect(parseHexColor("#007ACC")).toBe(packRgb(0x00, 0x7a, 0xcc));
        expect(parseHexColor("#FFFFFF")).toBe(packRgb(255, 255, 255));
        expect(parseHexColor("#000000")).toBe(packRgb(0, 0, 0));
    });

    it("parses #RGB (short notation)", () => {
        expect(parseHexColor("#FFF")).toBe(packRgb(255, 255, 255));
        expect(parseHexColor("#000")).toBe(packRgb(0, 0, 0));
        expect(parseHexColor("#F00")).toBe(packRgb(255, 0, 0));
        expect(parseHexColor("#0AF")).toBe(packRgb(0, 0xaa, 0xff));
    });

    it("keeps the alpha of #RRGGBBAA — the engine composites it at paint time", () => {
        expect(parseHexColor("#007ACC80")).toBe(packRgba(0x00, 0x7a, 0xcc, 0x80));
        expect(parseHexColor("#F1F1F133")).toBe(packRgba(0xf1, 0xf1, 0xf1, 0x33));
        // Альфа 255 нормализуется в непрозрачное 24-битное число.
        expect(parseHexColor("#1E1E1EFF")).toBe(packRgb(0x1e, 0x1e, 0x1e));
        // Альфа 0 — прозрачный сентинел: RGB такого цвета ничего не значит.
        expect(parseHexColor("#FFFFFF00")).toBe(TRANSPARENT_COLOR);
    });

    it("keeps the alpha nibble of #RGBA", () => {
        expect(parseHexColor("#F008")).toBe(packRgba(255, 0, 0, 0x88));
        expect(parseHexColor("#FFFF")).toBe(packRgb(255, 255, 255));
        expect(parseHexColor("#FFF0")).toBe(TRANSPARENT_COLOR);
    });

    it("is case-insensitive", () => {
        expect(parseHexColor("#ffffff")).toBe(packRgb(255, 255, 255));
        expect(parseHexColor("#aaBBcc")).toBe(packRgb(0xaa, 0xbb, 0xcc));
    });

    it("throws on invalid input", () => {
        expect(() => parseHexColor("")).toThrow("must start with #");
        expect(() => parseHexColor("FFFFFF")).toThrow("must start with #");
        expect(() => parseHexColor("#FF")).toThrow("#FF");
        expect(() => parseHexColor("#FFFFFFFFF")).toThrow("#FFFFFFFFF");
        expect(() => parseHexColor("#GGGGGG")).toThrow("#GGGGGG");
    });
});

describe("isHexColor", () => {
    it("accepts the four VS Code notations", () => {
        for (const hex of ["#FFF", "#FFF8", "#1E1E1E", "#1e1e1e80"]) expect(isHexColor(hex), hex).toBe(true);
    });

    it("rejects everything else without throwing", () => {
        for (const value of ["", "1E1E1E", "#FF", "#FFFFFFFFF", "#GGGGGG", "red", 0x1e1e1e, null, undefined]) {
            expect(isHexColor(value), String(value)).toBe(false);
        }
    });
});
