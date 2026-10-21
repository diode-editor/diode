import { packRgb } from "@tuidom/core/common/colorUtils";
import { describe, expect, it } from "vitest";

import { buildXtermPalette, xtermPaletteToRgb } from "./xtermPalette.ts";

// Expectations follow the canonical xterm-256color table (the same one `infocmp`/xterm prints).

describe("xtermPaletteToRgb — 16 системных цветов", () => {
    it.each([
        [0, 0, 0, 0], // black
        [1, 128, 0, 0], // red
        [2, 0, 128, 0], // green
        [3, 128, 128, 0], // yellow
        [4, 0, 0, 128], // blue
        [5, 128, 0, 128], // magenta
        [6, 0, 128, 128], // cyan
        [7, 192, 192, 192], // white
        [8, 128, 128, 128], // bright black
        [9, 255, 0, 0], // bright red
        [10, 0, 255, 0], // bright green
        [11, 255, 255, 0], // bright yellow
        [12, 0, 0, 255], // bright blue
        [13, 255, 0, 255], // bright magenta
        [14, 0, 255, 255], // bright cyan
        [15, 255, 255, 255], // bright white
    ])("index %i → rgb(%i, %i, %i)", (index, r, g, b) => {
        expect(xtermPaletteToRgb(index)).toBe(packRgb(r, g, b));
    });
});

describe("xtermPaletteToRgb — куб 6×6×6 (16..231)", () => {
    const LEVELS = [0, 95, 135, 175, 215, 255];

    it.each([
        [16, 0, 0, 0], // cube start — black
        [17, 0, 0, 95], // +1 in b
        [21, 0, 0, 255], // max b
        [22, 0, 95, 0], // +1 in g
        [52, 95, 0, 0], // +1 in r
        [196, 255, 0, 0], // pure cube red
        [46, 0, 255, 0], // pure cube green
        [231, 255, 255, 255], // cube end — white
    ])("index %i → rgb(%i, %i, %i)", (index, r, g, b) => {
        expect(xtermPaletteToRgb(index)).toBe(packRgb(r, g, b));
    });

    it("покрывает все 216 индексов по формуле 16 + 36*r + 6*g + b", () => {
        for (let r = 0; r < 6; r++) {
            for (let g = 0; g < 6; g++) {
                for (let b = 0; b < 6; b++) {
                    const index = 16 + 36 * r + 6 * g + b;
                    expect(xtermPaletteToRgb(index)).toBe(packRgb(LEVELS[r], LEVELS[g], LEVELS[b]));
                }
            }
        }
    });
});

describe("xtermPaletteToRgb — серая шкала (232..255)", () => {
    it.each([
        [232, 8], // ramp start
        [233, 18],
        [243, 118], // middle
        [255, 238], // ramp end
    ])("index %i → серый %i", (index, level) => {
        expect(xtermPaletteToRgb(index)).toBe(packRgb(level, level, level));
    });

    it("покрывает все 24 оттенка по формуле 8 + i*10", () => {
        for (let i = 0; i < 24; i++) {
            const level = 8 + i * 10;
            expect(xtermPaletteToRgb(232 + i)).toBe(packRgb(level, level, level));
        }
    });
});

describe("xtermPaletteToRgb — индексы вне диапазона", () => {
    // Outside 0..255 there is no table — fall back to index 7 (white) so text doesn't disappear.
    const WHITE = packRgb(192, 192, 192);

    it.each([[-1], [256], [1000], [0.5], [Number.NaN]])("index %p → фоллбэк на белый index 7", (index) => {
        expect(xtermPaletteToRgb(index)).toBe(WHITE);
    });
});

describe("buildXtermPalette — свои 16 системных цветов", () => {
    const ansi = Array.from({ length: 16 }, (_, i) => packRgb(i, 1, 2));
    const palette = buildXtermPalette(ansi);

    it("0..15 берутся из переданных, по индексу", () => {
        for (let i = 0; i < 16; i++) expect(xtermPaletteToRgb(i, palette)).toBe(packRgb(i, 1, 2));
    });

    it("куб и серые остаются каноническими", () => {
        expect(palette).toHaveLength(256);
        for (let i = 16; i < 256; i++) expect(xtermPaletteToRgb(i, palette)).toBe(xtermPaletteToRgb(i));
    });

    it("переданный массив не трогает", () => {
        expect(ansi).toHaveLength(16);
    });

    it("вне диапазона — фоллбэк на свой index 7", () => {
        expect(xtermPaletteToRgb(256, palette)).toBe(packRgb(7, 1, 2));
    });
});
