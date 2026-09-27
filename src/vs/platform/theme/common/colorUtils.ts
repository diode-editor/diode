import { parseHexColor as parseTuidomHexColor } from "@tuidom/core/common/colorUtils";

/**
 * Разбирает hex-цвет темы VS Code (`#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA`) в
 * число tuidom. Альфа сохраняется: `#RRGGBBAA` даёт полупрозрачное значение
 * (`packRgba`), которое движок композитит в порядке отрисовки (STYLES.md,
 * «Модель цвета»); непрозрачный цвет — прежнее 24-битное число.
 *
 * Формат VS Code требует ведущий `#` — в отличие от парсера tuidom, который
 * принимает и голые цифры. Бросает на невалидной строке.
 */
export function parseHexColor(hex: string): number {
    if (!hex.startsWith("#")) {
        throw new Error(`Invalid hex color: "${hex}" (must start with #)`);
    }
    return parseTuidomHexColor(hex);
}

/** Допустимая ли это hex-строка цвета темы (см. {@link parseHexColor}). */
export function isHexColor(value: unknown): value is string {
    return typeof value === "string" && /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value);
}
