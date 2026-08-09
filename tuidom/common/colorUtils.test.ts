import { describe, expect, it } from "vitest";

import { blendRgb, DEFAULT_COLOR, packRgb, unpackB, unpackG, unpackR } from "./colorUtils.ts";

describe("ColorUtils", () => {
    describe("packRgb / unpack round-trip", () => {
        it("packs (0, 0, 0) into 0x000000", () => {
            expect(packRgb(0, 0, 0)).toBe(0x000000);
        });

        it("packs (255, 255, 255) into 0xFFFFFF", () => {
            expect(packRgb(255, 255, 255)).toBe(0xffffff);
        });

        it("packs pure red (255, 0, 0) into 0xFF0000", () => {
            expect(packRgb(255, 0, 0)).toBe(0xff0000);
        });

        it("packs pure green (0, 255, 0) into 0x00FF00", () => {
            expect(packRgb(0, 255, 0)).toBe(0x00ff00);
        });

        it("packs pure blue (0, 0, 255) into 0x0000FF", () => {
            expect(packRgb(0, 0, 255)).toBe(0x0000ff);
        });

        it("round-trips arbitrary color (42, 128, 200)", () => {
            const packed = packRgb(42, 128, 200);
            expect(unpackR(packed)).toBe(42);
            expect(unpackG(packed)).toBe(128);
            expect(unpackB(packed)).toBe(200);
        });

        it("round-trips all-zero and all-max", () => {
            const black = packRgb(0, 0, 0);
            expect(unpackR(black)).toBe(0);
            expect(unpackG(black)).toBe(0);
            expect(unpackB(black)).toBe(0);

            const white = packRgb(255, 255, 255);
            expect(unpackR(white)).toBe(255);
            expect(unpackG(white)).toBe(255);
            expect(unpackB(white)).toBe(255);
        });
    });

    describe("DEFAULT_COLOR", () => {
        it("is negative (never collides with valid packed RGB)", () => {
            expect(DEFAULT_COLOR).toBeLessThan(0);
        });
    });

    describe("blendRgb", () => {
        it("returns the backdrop at alpha 0 and the overlay at alpha 1", () => {
            const fg = packRgb(0xf1, 0xf1, 0xf1);
            const bg = packRgb(0x18, 0x18, 0x18);
            expect(blendRgb(fg, bg, 0)).toBe(bg);
            expect(blendRgb(fg, bg, 1)).toBe(fg);
        });

        it("mixes each channel by the alpha share", () => {
            const white = packRgb(255, 255, 255);
            const black = packRgb(0, 0, 0);
            expect(blendRgb(white, black, 0.5)).toBe(packRgb(128, 128, 128));
            // #F1F1F1 at 0x33/0xFF over #181818 — Dark Modern's status bar hover.
            expect(blendRgb(packRgb(0xf1, 0xf1, 0xf1), packRgb(0x18, 0x18, 0x18), 0x33 / 0xff)).toBe(
                packRgb(0x43, 0x43, 0x43),
            );
        });

        it("mixes channels independently", () => {
            const red = packRgb(200, 0, 0);
            const blue = packRgb(0, 0, 100);
            expect(blendRgb(red, blue, 0.5)).toBe(packRgb(100, 0, 50));
        });
    });
});
