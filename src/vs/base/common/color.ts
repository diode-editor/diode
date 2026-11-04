/**
 * The slice of upstream `base/common/color.ts` the default color detector needs: `RGBA`, `HSLA` with
 * its conversion to RGB, and `Color.Format.CSS.parseHex` (returning the `RGBA` instead of a `Color`);
 * plus `Color.Format.CSS.parse` for colors extensions pass as CSS strings ({@link parseCssColor}).
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

/** `<number>` of CSS: fractional and exponent forms included (Tailwind sends `239.00000000000003`). */
const CSS_NUMBER = String.raw`\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*`;
const RGBA_FUNCTION = new RegExp(`^rgba\\(${CSS_NUMBER},${CSS_NUMBER},${CSS_NUMBER},${CSS_NUMBER}\\)$`, "i");
const RGB_FUNCTION = new RegExp(`^rgb\\(${CSS_NUMBER},${CSS_NUMBER},${CSS_NUMBER}\\)$`, "i");
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** https://drafts.csswg.org/css-color/#named-colors, as upstream `parseNamedKeyword` lists them. */
const NAMED_COLORS: Readonly<Record<string, readonly [number, number, number]>> = {
    aliceblue: [240, 248, 255],
    antiquewhite: [250, 235, 215],
    aqua: [0, 255, 255],
    aquamarine: [127, 255, 212],
    azure: [240, 255, 255],
    beige: [245, 245, 220],
    bisque: [255, 228, 196],
    black: [0, 0, 0],
    blanchedalmond: [255, 235, 205],
    blue: [0, 0, 255],
    blueviolet: [138, 43, 226],
    brown: [165, 42, 42],
    burlywood: [222, 184, 135],
    cadetblue: [95, 158, 160],
    chartreuse: [127, 255, 0],
    chocolate: [210, 105, 30],
    coral: [255, 127, 80],
    cornflowerblue: [100, 149, 237],
    cornsilk: [255, 248, 220],
    crimson: [220, 20, 60],
    cyan: [0, 255, 255],
    darkblue: [0, 0, 139],
    darkcyan: [0, 139, 139],
    darkgoldenrod: [184, 134, 11],
    darkgray: [169, 169, 169],
    darkgreen: [0, 100, 0],
    darkgrey: [169, 169, 169],
    darkkhaki: [189, 183, 107],
    darkmagenta: [139, 0, 139],
    darkolivegreen: [85, 107, 47],
    darkorange: [255, 140, 0],
    darkorchid: [153, 50, 204],
    darkred: [139, 0, 0],
    darksalmon: [233, 150, 122],
    darkseagreen: [143, 188, 143],
    darkslateblue: [72, 61, 139],
    darkslategray: [47, 79, 79],
    darkslategrey: [47, 79, 79],
    darkturquoise: [0, 206, 209],
    darkviolet: [148, 0, 211],
    deeppink: [255, 20, 147],
    deepskyblue: [0, 191, 255],
    dimgray: [105, 105, 105],
    dimgrey: [105, 105, 105],
    dodgerblue: [30, 144, 255],
    firebrick: [178, 34, 34],
    floralwhite: [255, 250, 240],
    forestgreen: [34, 139, 34],
    fuchsia: [255, 0, 255],
    gainsboro: [220, 220, 220],
    ghostwhite: [248, 248, 255],
    gold: [255, 215, 0],
    goldenrod: [218, 165, 32],
    gray: [128, 128, 128],
    green: [0, 128, 0],
    greenyellow: [173, 255, 47],
    grey: [128, 128, 128],
    honeydew: [240, 255, 240],
    hotpink: [255, 105, 180],
    indianred: [205, 92, 92],
    indigo: [75, 0, 130],
    ivory: [255, 255, 240],
    khaki: [240, 230, 140],
    lavender: [230, 230, 250],
    lavenderblush: [255, 240, 245],
    lawngreen: [124, 252, 0],
    lemonchiffon: [255, 250, 205],
    lightblue: [173, 216, 230],
    lightcoral: [240, 128, 128],
    lightcyan: [224, 255, 255],
    lightgoldenrodyellow: [250, 250, 210],
    lightgray: [211, 211, 211],
    lightgreen: [144, 238, 144],
    lightgrey: [211, 211, 211],
    lightpink: [255, 182, 193],
    lightsalmon: [255, 160, 122],
    lightseagreen: [32, 178, 170],
    lightskyblue: [135, 206, 250],
    lightslategray: [119, 136, 153],
    lightslategrey: [119, 136, 153],
    lightsteelblue: [176, 196, 222],
    lightyellow: [255, 255, 224],
    lime: [0, 255, 0],
    limegreen: [50, 205, 50],
    linen: [250, 240, 230],
    magenta: [255, 0, 255],
    maroon: [128, 0, 0],
    mediumaquamarine: [102, 205, 170],
    mediumblue: [0, 0, 205],
    mediumorchid: [186, 85, 211],
    mediumpurple: [147, 112, 219],
    mediumseagreen: [60, 179, 113],
    mediumslateblue: [123, 104, 238],
    mediumspringgreen: [0, 250, 154],
    mediumturquoise: [72, 209, 204],
    mediumvioletred: [199, 21, 133],
    midnightblue: [25, 25, 112],
    mintcream: [245, 255, 250],
    mistyrose: [255, 228, 225],
    moccasin: [255, 228, 181],
    navajowhite: [255, 222, 173],
    navy: [0, 0, 128],
    oldlace: [253, 245, 230],
    olive: [128, 128, 0],
    olivedrab: [107, 142, 35],
    orange: [255, 165, 0],
    orangered: [255, 69, 0],
    orchid: [218, 112, 214],
    palegoldenrod: [238, 232, 170],
    palegreen: [152, 251, 152],
    paleturquoise: [175, 238, 238],
    palevioletred: [219, 112, 147],
    papayawhip: [255, 239, 213],
    peachpuff: [255, 218, 185],
    peru: [205, 133, 63],
    pink: [255, 192, 203],
    plum: [221, 160, 221],
    powderblue: [176, 224, 230],
    purple: [128, 0, 128],
    rebeccapurple: [102, 51, 153],
    red: [255, 0, 0],
    rosybrown: [188, 143, 143],
    royalblue: [65, 105, 225],
    saddlebrown: [139, 69, 19],
    salmon: [250, 128, 114],
    sandybrown: [244, 164, 96],
    seagreen: [46, 139, 87],
    seashell: [255, 245, 238],
    sienna: [160, 82, 45],
    silver: [192, 192, 192],
    skyblue: [135, 206, 235],
    slateblue: [106, 90, 205],
    slategray: [112, 128, 144],
    slategrey: [112, 128, 144],
    snow: [255, 250, 250],
    springgreen: [0, 255, 127],
    steelblue: [70, 130, 180],
    tan: [210, 180, 140],
    teal: [0, 128, 128],
    thistle: [216, 191, 216],
    tomato: [255, 99, 71],
    turquoise: [64, 224, 208],
    violet: [238, 130, 238],
    wheat: [245, 222, 179],
    white: [255, 255, 255],
    whitesmoke: [245, 245, 245],
    yellow: [255, 255, 0],
    yellowgreen: [154, 205, 50],
};

/** RGBA truncates; a browser rounds. */
function channel(text: string): number {
    return Math.round(Number(text));
}

/**
 * Upstream `Color.Format.CSS.parse`, returning the `RGBA` instead of a `Color`: `transparent`,
 * `#hex` (3/4/6/8 digits), `rgb()`, `rgba()` and the named colors. Deviations: channels take any CSS
 * `<number>`, rounded like a browser does, and a string it does not understand (including a hex with a
 * non-hex digit) is `null` instead of an exception — extension input must not crash the host.
 */
export function parseCssColor(css: string): RGBA | null {
    if (css === "transparent") return new RGBA(0, 0, 0, 0);
    if (HEX_COLOR.test(css)) return parseHex(css);
    const fn = RGBA_FUNCTION.exec(css) ?? RGB_FUNCTION.exec(css);
    // `rgb()` has no fourth group; RGBA clamps the channels and the alpha.
    if (fn !== null) return new RGBA(channel(fn[1]), channel(fn[2]), channel(fn[3]), fn.length > 4 ? Number(fn[4]) : 1);
    const named = Object.hasOwn(NAMED_COLORS, css) ? NAMED_COLORS[css] : undefined;
    return named === undefined ? null : new RGBA(named[0], named[1], named[2]);
}
