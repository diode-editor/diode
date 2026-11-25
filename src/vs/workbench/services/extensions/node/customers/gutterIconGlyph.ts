import { packRgba } from "@tuidom/core/common/colorUtils";

import { parseCssColor } from "../../../../../base/common/color.ts";
import { Uri } from "../../../../../base/common/uri.ts";

/** Reads a `file:` (or another provider's) gutter icon; a rejection is a missing icon. */
export type GutterIconReader = (resource: Uri) => Promise<Uint8Array>;

/**
 * What a gutter icon (`gutterIconPath`) shrinks to in one cell: a glyph and the icon's color, packed RGBA; no color
 * means the gutter's own.
 */
export interface IGutterIconGlyph {
    readonly glyph: string;
    readonly color?: number;
}

/** A thin bar at the cell's left edge: GitLens's heatmap, change and blame bars. */
const BAR_GLYPH = "▎";
/** GitLens's "deleted lines" marker. */
const TRIANGLE_GLYPH = "▸";
/** Every other icon: Error Lens's circles and squares, todo-tree's generated icons, a PNG. */
const DOT_GLYPH = "●";

const SHAPE = /<(rect|circle|ellipse|polygon|polyline|path|line)\b([^>]*)>/gi;
/** An attribute (`fill="#f00"`) or a CSS declaration (`fill: #f00`); the value with its quotes. */
const PAINT = /\b(?:fill|stroke)\s*[=:]\s*["']?([^;"'>]*)/gi;

function attribute(attributes: string, name: string): string | undefined {
    return new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`).exec(attributes)?.[2];
}

/** At least twice as tall as wide (of the shapes only a rect has a size); a percent or an absent size is no bar. */
function isBar(attributes: string): boolean {
    const width = Number(attribute(attributes, "width"));
    const height = Number(attribute(attributes, "height"));
    return width > 0 && height >= 2 * width;
}

/**
 * Three corners, the closing repeat of the first one allowed; a path of straight lines only. Signs do not change the
 * count, and an exponent is no icon coordinate.
 */
function isTriangle(geometry: string | undefined): boolean {
    // Stryker disable next-line ConditionalExpression: equivalent, `test(undefined)` reads "undefined", whose letters fail the check
    if (geometry === undefined || /[^MLZmlz\d\s.,-]/.test(geometry)) return false;
    const numbers = [...geometry.matchAll(/[\d.]+/g)].map(([n]) => n);
    return numbers.length === 6 || (numbers.length === 8 && numbers[0] === numbers[6] && numbers[1] === numbers[7]);
}

/**
 * The most saturated paint of the icon, the first one of a tie: Error Lens's stock icons put a gray backdrop
 * (`#1e1e1e`) before the colored sign. `none`, `currentColor`, a gradient and a transparent paint are no color.
 */
function iconColorOf(svg: string): number | undefined {
    let best: { color: number; chroma: number } | undefined;
    for (const [, value] of svg.matchAll(PAINT)) {
        const rgba = parseCssColor(value.trim());
        if (rgba === null || rgba.a === 0) continue;
        const chroma = Math.max(rgba.r, rgba.g, rgba.b) - Math.min(rgba.r, rgba.g, rgba.b);
        if (best === undefined || chroma > best.chroma) {
            best = { color: packRgba(rgba.r, rgba.g, rgba.b, Math.round(rgba.a * 255)), chroma };
        }
    }
    return best?.color;
}

/**
 * Upstream draws the icon as a CSS background; a cell fits one glyph, picked by the icon's shape: a single tall
 * `<rect>` is a bar, a single triangle a `▸`, anything else a dot. Not an SVG (a PNG, a read error) — a dot in the
 * gutter's color.
 */
export function gutterIconGlyphOf(content: string): IGutterIconGlyph {
    if (!/<svg\b/i.test(content)) return { glyph: DOT_GLYPH };
    const shapes = [...content.matchAll(SHAPE)].map(([, tag, attributes]) => ({ tag: tag.toLowerCase(), attributes }));
    let glyph = DOT_GLYPH;
    if (shapes.length === 1) {
        const [{ tag, attributes }] = shapes;
        const geometry =
            tag === "polygon"
                ? attribute(attributes, "points")
                : tag === "path"
                  ? attribute(attributes, "d")
                  : undefined;
        if (isBar(attributes)) glyph = BAR_GLYPH;
        else if (isTriangle(geometry)) glyph = TRIANGLE_GLYPH;
    }
    const color = iconColorOf(content);
    return color === undefined ? { glyph } : { glyph, color };
}

/** The icon's text: a `data:` URI's payload as is, a file through `readFile`; a failed read is no text. */
export async function gutterIconContentOf(uri: string, readFile: GutterIconReader): Promise<string> {
    try {
        const parsed = Uri.parse(uri);
        if (parsed.scheme !== "data") return new TextDecoder().decode(await readFile(parsed));
        // An unencoded `#` (`fill='#f00'`) splits the URI into a fragment; the payload is the whole of it.
        const query = parsed.query === "" ? "" : `?${parsed.query}`;
        const fragment = parsed.fragment === "" ? "" : `#${parsed.fragment}`;
        const raw = parsed.path + query + fragment;
        const comma = raw.indexOf(",");
        if (comma < 0) return "";
        const payload = raw.slice(comma + 1);
        return raw.slice(0, comma).endsWith(";base64") ? Buffer.from(payload, "base64").toString("utf8") : payload;
    } catch {
        return "";
    }
}
