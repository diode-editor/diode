// @xterm/headless doesn't apply a theme: in palette mode `getFgColor()` returns an index 0..255, not RGB, so we
// expand it ourselves using the canonical xterm table (0..15 system, 16..231 6×6×6 cube, 232..255 grays). A live
// session replaces the first 16 via `buildXtermPalette` according to `terminal.integrated.colorSource`.

import { packRgb } from "@tuidom/core/common/colorUtils";

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

/** Palette index (0..255) → packed RGB. */
export type XtermPalette = readonly number[];

/** `ansi[i]` is the color of index i (0..15); the cube and grays stay canonical. */
export function buildXtermPalette(ansi: readonly number[]): XtermPalette {
    const table = ansi.slice(0, 16);

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

export const DEFAULT_XTERM_PALETTE = buildXtermPalette(SYSTEM_16);

/** Outside the table falls back to index 7 (white) so text doesn't disappear. */
export function xtermPaletteToRgb(index: number, palette: XtermPalette = DEFAULT_XTERM_PALETTE): number {
    return palette[index] ?? palette[7];
}
