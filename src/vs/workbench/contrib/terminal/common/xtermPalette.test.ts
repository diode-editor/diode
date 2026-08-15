import { describe, expect, it } from "vitest";

import { packRgb } from "@tuidom/core/common/colorUtils";

import { xtermPaletteToRgb } from "./xtermPalette.ts";

// Эталон — каноническая таблица xterm-256color (та же, что печатает `infocmp`/xterm):
//   0..15 — системные ANSI, 16..231 — куб 6×6×6, 232..255 — 24 оттенка серого.

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
        [16, 0, 0, 0], // начало куба — чёрный
        [17, 0, 0, 95], // +1 по b
        [21, 0, 0, 255], // максимум по b
        [22, 0, 95, 0], // +1 по g
        [52, 95, 0, 0], // +1 по r
        [196, 255, 0, 0], // чистый красный куба
        [46, 0, 255, 0], // чистый зелёный куба
        [231, 255, 255, 255], // конец куба — белый
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
        [232, 8], // начало рампы
        [233, 18],
        [243, 118], // середина
        [255, 238], // конец рампы
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
    // Вне 0..255 таблицы нет — откатываемся на index 7 (белый), чтобы текст не пропал.
    const WHITE = packRgb(192, 192, 192);

    it.each([[-1], [256], [1000], [0.5], [Number.NaN]])("index %p → фоллбэк на белый index 7", (index) => {
        expect(xtermPaletteToRgb(index)).toBe(WHITE);
    });
});
