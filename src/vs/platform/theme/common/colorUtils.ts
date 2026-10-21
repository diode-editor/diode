import { parseHexColor as parseTuidomHexColor } from "@tuidom/core/common/colorUtils";

/** Ведущий `#` обязателен, в отличие от парсера tuidom. Альфа сохраняется (`packRgba`). Бросает на невалидной строке. */
export function parseHexColor(hex: string): number {
    if (!hex.startsWith("#")) {
        throw new Error(`Invalid hex color: "${hex}" (must start with #)`);
    }
    return parseTuidomHexColor(hex);
}

export function isHexColor(value: unknown): value is string {
    return typeof value === "string" && /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value);
}
