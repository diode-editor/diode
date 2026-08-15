import { packRgb } from "@tuidom/core/common/colorUtils";

/**
 * Parse a CSS hex color string into a packed 24-bit RGB integer.
 * Supports formats: `#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA`.
 * Alpha channel is stripped (we only use opaque colors in the TUI).
 *
 * Throws on invalid input.
 */
export function parseHexColor(hex: string): number {
    if (!hex.startsWith("#")) {
        throw new Error(`Invalid hex color: "${hex}" (must start with #)`);
    }
    const body = hex.slice(1);
    switch (body.length) {
        case 3: {
            // #RGB → expand to #RRGGBB
            const r = parseInt(body[0] + body[0], 16);
            const g = parseInt(body[1] + body[1], 16);
            const b = parseInt(body[2] + body[2], 16);
            return packRgb(r, g, b);
        }
        case 4: {
            // #RGBA → expand to #RRGGBB (drop alpha)
            const r = parseInt(body[0] + body[0], 16);
            const g = parseInt(body[1] + body[1], 16);
            const b = parseInt(body[2] + body[2], 16);
            return packRgb(r, g, b);
        }
        case 6: {
            // #RRGGBB
            const r = parseInt(body.slice(0, 2), 16);
            const g = parseInt(body.slice(2, 4), 16);
            const b = parseInt(body.slice(4, 6), 16);
            return packRgb(r, g, b);
        }
        case 8: {
            // #RRGGBBAA (drop alpha)
            const r = parseInt(body.slice(0, 2), 16);
            const g = parseInt(body.slice(2, 4), 16);
            const b = parseInt(body.slice(4, 6), 16);
            return packRgb(r, g, b);
        }
        default:
            throw new Error(`Invalid hex color: "${hex}" (unexpected length ${body.length.toString()})`);
    }
}

/**
 * Альфа-канал hex-строки как 0–255 (255 для форм без альфы). Нужен цветам с
 * `blendOver`: сам цвет парсится непрозрачным, а долю наложения берём отсюда.
 *
 * Формат не валидирует — вызывается после {@link parseHexColor}.
 */
export function parseHexAlpha(hex: string): number {
    const body = hex.slice(1);
    switch (body.length) {
        case 4:
            return parseInt(body[3] + body[3], 16);
        case 8:
            return parseInt(body.slice(6, 8), 16);
        default:
            return 0xff;
    }
}
