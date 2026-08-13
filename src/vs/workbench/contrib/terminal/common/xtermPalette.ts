// Стандартная xterm-палитра из 256 цветов → packed RGB.
//
// @xterm/headless держит модель экрана, но НЕ применяет тему: в palette-режиме
// `cell.getFgColor()` отдаёт индекс 0..255, а не RGB (в отличие от truecolor-режима,
// где отдаётся уже 0xRRGGBB). Поэтому palette-индексы разворачиваем в RGB сами по
// канонической таблице xterm:
//   - 0..15   — 16 системных ANSI-цветов (значения по умолчанию xterm);
//   - 16..231 — куб 6×6×6 (по осям r,g,b уровни 0..5, уровень→0/95/135/175/215/255);
//   - 232..255 — 24 оттенка серого (8, 18, …, 238).
//
// Здесь зафиксированы «дефолтные» цвета xterm; в будущем таблица подменяется палитрой
// активной темы Vexx (см. docs/TODO/IntegratedTerminal.md).

import { packRgb } from "@tuidom/all/common/colorUtils";

const SYSTEM_16: readonly number[] = [
    packRgb(0, 0, 0), // 0  black
    packRgb(128, 0, 0), // 1  red
    packRgb(0, 128, 0), // 2  green
    packRgb(128, 128, 0), // 3  yellow
    packRgb(0, 0, 128), // 4  blue
    packRgb(128, 0, 128), // 5  magenta
    packRgb(0, 128, 128), // 6  cyan
    packRgb(192, 192, 192), // 7  white
    packRgb(128, 128, 128), // 8  bright black
    packRgb(255, 0, 0), // 9  bright red
    packRgb(0, 255, 0), // 10 bright green
    packRgb(255, 255, 0), // 11 bright yellow
    packRgb(0, 0, 255), // 12 bright blue
    packRgb(255, 0, 255), // 13 bright magenta
    packRgb(0, 255, 255), // 14 bright cyan
    packRgb(255, 255, 255), // 15 bright white
];

const CUBE_LEVELS: readonly number[] = [0, 95, 135, 175, 215, 255];

function buildPalette(): readonly number[] {
    const table = new Array<number>(256);
    for (let i = 0; i < 16; i++) table[i] = SYSTEM_16[i];

    // 6×6×6 color cube (indices 16..231)
    for (let r = 0; r < 6; r++) {
        for (let g = 0; g < 6; g++) {
            for (let b = 0; b < 6; b++) {
                const index = 16 + 36 * r + 6 * g + b;
                table[index] = packRgb(CUBE_LEVELS[r], CUBE_LEVELS[g], CUBE_LEVELS[b]);
            }
        }
    }

    // Grayscale ramp (indices 232..255)
    for (let i = 0; i < 24; i++) {
        const level = 8 + i * 10;
        table[232 + i] = packRgb(level, level, level);
    }

    return table;
}

const PALETTE = buildPalette();

/** Разворачивает palette-индекс xterm (0..255) в packed RGB. */
export function xtermPaletteToRgb(index: number): number {
    return PALETTE[index] ?? PALETTE[7];
}
