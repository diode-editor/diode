/**
 * Sentinel value meaning "use terminal's default color".
 * Must be negative so it's never confused with a packed RGB value (0x000000–0xFFFFFF).
 */
export const DEFAULT_COLOR = -1;

/** Pack three 8-bit channels into a single 24-bit integer. */
export function packRgb(r: number, g: number, b: number): number {
    return (r << 16) | (g << 8) | b;
}

/** Extract the red channel (bits 16–23). */
export function unpackR(color: number): number {
    return (color >> 16) & 0xff;
}

/** Extract the green channel (bits 8–15). */
export function unpackG(color: number): number {
    return (color >> 8) & 0xff;
}

/** Extract the blue channel (bits 0–7). */
export function unpackB(color: number): number {
    return color & 0xff;
}

/**
 * Накладывает полупрозрачный `fg` на непрозрачную подложку `bg` и возвращает
 * непрозрачный результат: терминал альфы не умеет, поэтому композитинг
 * выполняется заранее (`alpha` — доля 0..1).
 */
export function blendRgb(fg: number, bg: number, alpha: number): number {
    const mix = (f: number, b: number): number => Math.round(f * alpha + b * (1 - alpha));
    return packRgb(
        mix(unpackR(fg), unpackR(bg)),
        mix(unpackG(fg), unpackG(bg)),
        mix(unpackB(fg), unpackB(bg)),
    );
}
