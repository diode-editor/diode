/**
 * The slice of upstream `base/common/color.ts` the default color detector needs: `RGBA`, `HSLA` with
 * its conversion to RGB, and `Color.Format.CSS.parseHex` (returning the `RGBA` instead of a `Color`).
 */

function roundFloat(number: number, decimalPoints: number): number {
    const decimal = Math.pow(10, decimalPoints);
    return Math.round(number * decimal) / decimal;
}

export class RGBA {
    /** Red: integer in [0-255]. */
    public readonly r: number;
    /** Green: integer in [0-255]. */
    public readonly g: number;
    /** Blue: integer in [0-255]. */
    public readonly b: number;
    /** Alpha: float in [0-1]. */
    public readonly a: number;

    public constructor(r: number, g: number, b: number, a = 1) {
        this.r = Math.min(255, Math.max(0, r)) | 0;
        this.g = Math.min(255, Math.max(0, g)) | 0;
        this.b = Math.min(255, Math.max(0, b)) | 0;
        this.a = roundFloat(Math.max(Math.min(1, a), 0), 3);
    }
}

export class HSLA {
    /** Hue: integer in [0, 360]. */
    public readonly h: number;
    /** Saturation: float in [0, 1]. */
    public readonly s: number;
    /** Luminosity: float in [0, 1]. */
    public readonly l: number;
    /** Alpha: float in [0, 1]. */
    public readonly a: number;

    public constructor(h: number, s: number, l: number, a: number) {
        this.h = Math.max(Math.min(360, h), 0) | 0;
        this.s = roundFloat(Math.max(Math.min(1, s), 0), 3);
        this.l = roundFloat(Math.max(Math.min(1, l), 0), 3);
        this.a = roundFloat(Math.max(Math.min(1, a), 0), 3);
    }

    private static hue2rgb(p: number, q: number, t: number): number {
        let hue = t;
        // Stryker disable EqualityOperator: on each boundary both sides give the same value (p at 0 and 1, q at 1/6 and 1/2, p at 2/3)
        if (hue < 0) hue += 1;
        if (hue > 1) hue -= 1;
        if (hue < 1 / 6) return p + (q - p) * 6 * hue;
        if (hue < 1 / 2) return q;
        if (hue < 2 / 3) return p + (q - p) * (2 / 3 - hue) * 6;
        // Stryker restore EqualityOperator
        return p;
    }

    /**
     * Formula from http://en.wikipedia.org/wiki/HSL_color_space: h in [0, 360], s and l in [0, 1]
     * give r, g and b in [0, 255].
     */
    public static toRGBA(hsla: HSLA): RGBA {
        const h = hsla.h / 360;
        const { s, l, a } = hsla;
        let r: number;
        let g: number;
        let b: number;
        // Stryker disable next-line ConditionalExpression,EqualityOperator: with s = 0 the formula gives q = p = l, the same gray
        if (s === 0) {
            // achromatic
            r = g = b = l;
        } else {
            // Stryker disable next-line EqualityOperator: at l = 0.5 both branches give 0.5 + 0.5s
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = HSLA.hue2rgb(p, q, h + 1 / 3);
            g = HSLA.hue2rgb(p, q, h);
            b = HSLA.hue2rgb(p, q, h - 1 / 3);
        }
        return new RGBA(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), a);
    }
}

function parseHexDigit(charCode: number): number {
    const digit = parseInt(String.fromCharCode(charCode), 16);
    return Number.isNaN(digit) ? 0 : digit;
}

/** `#RGB`, `#RGBA`, `#RRGGBB` or `#RRGGBBAA`; any other shape is `null`, a digit outside `0-9a-f` counts as 0 (upstream). */
export function parseHex(hex: string): RGBA | null {
    if (!hex.startsWith("#")) return null;
    const digit = (index: number): number => parseHexDigit(hex.charCodeAt(index));
    switch (hex.length) {
        case 7:
            return new RGBA(16 * digit(1) + digit(2), 16 * digit(3) + digit(4), 16 * digit(5) + digit(6), 1);
        case 9:
            return new RGBA(
                16 * digit(1) + digit(2),
                16 * digit(3) + digit(4),
                16 * digit(5) + digit(6),
                (16 * digit(7) + digit(8)) / 255,
            );
        case 4:
            return new RGBA(17 * digit(1), 17 * digit(2), 17 * digit(3));
        case 5:
            return new RGBA(17 * digit(1), 17 * digit(2), 17 * digit(3), (17 * digit(4)) / 255);
        default:
            return null;
    }
}
