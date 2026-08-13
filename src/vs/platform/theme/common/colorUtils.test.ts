import { describe, expect, it } from "vitest";

import { packRgb } from "@tuidom/all/common/colorUtils";

import { parseHexAlpha, parseHexColor } from "./colorUtils.ts";

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

    it("parses #RRGGBBAA (strips alpha)", () => {
        expect(parseHexColor("#1E1E1EFF")).toBe(packRgb(0x1e, 0x1e, 0x1e));
        expect(parseHexColor("#007ACC80")).toBe(packRgb(0x00, 0x7a, 0xcc));
        expect(parseHexColor("#FFFFFF00")).toBe(packRgb(255, 255, 255));
    });

    it("parses #RGBA (short notation, strips alpha)", () => {
        expect(parseHexColor("#FFF0")).toBe(packRgb(255, 255, 255));
        expect(parseHexColor("#F00F")).toBe(packRgb(255, 0, 0));
    });

    it("is case-insensitive", () => {
        expect(parseHexColor("#ffffff")).toBe(packRgb(255, 255, 255));
        expect(parseHexColor("#aaBBcc")).toBe(packRgb(0xaa, 0xbb, 0xcc));
    });

    it("throws on invalid input", () => {
        expect(() => parseHexColor("")).toThrow("must start with #");
        expect(() => parseHexColor("FFFFFF")).toThrow("must start with #");
        expect(() => parseHexColor("#FF")).toThrow("unexpected length");
        expect(() => parseHexColor("#FFFFFFFFF")).toThrow("unexpected length");
    });
});

describe("parseHexAlpha", () => {
    it("reads the alpha byte of #RRGGBBAA", () => {
        expect(parseHexAlpha("#F1F1F133")).toBe(0x33);
        expect(parseHexAlpha("#00000000")).toBe(0);
        expect(parseHexAlpha("#FFFFFFFF")).toBe(0xff);
    });

    it("expands the alpha nibble of #RGBA", () => {
        expect(parseHexAlpha("#FFF8")).toBe(0x88);
        expect(parseHexAlpha("#FFF0")).toBe(0);
    });

    it("reports opaque for notations without alpha", () => {
        expect(parseHexAlpha("#1E1E1E")).toBe(0xff);
        expect(parseHexAlpha("#FFF")).toBe(0xff);
    });
});
