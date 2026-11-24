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
const PAINT = /\b(?:fill|stroke)\s*[=:]\s*("[^"]*"|'[^']*'|[^;"'>]+)/gi;

function attribute(attributes: string, name: string): string | undefined {
    return new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i").exec(attributes)?.[2];
}

/** A rect at least twice as tall as it is wide; a percent or an absent size is no bar. */
function isBar(attributes: string): boolean {
    const width = Number(attribute(attributes, "width"));
    const height = Number(attribute(attributes, "height"));
    return width > 0 && height >= 2 * width;
}

/** Three corners, the closing repeat of the first one allowed; a path of straight lines only. */
function isTriangle(tag: string, attributes: string): boolean {
    const geometry = attribute(attributes, tag === "path" ? "d" : "points") ?? "";
    if (tag === "path" && /[^MLZmlz\d\s.,eE+-]/.test(geometry)) return false;
    const numbers = geometry.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi) ?? [];
    return numbers.length === 6 || (numbers.length === 8 && numbers[0] === numbers[6] && numbers[1] === numbers[7]);
}

/**
 * The most saturated paint of the icon, the first one of a tie: Error Lens's stock icons put a gray backdrop
 * (`#1e1e1e`) before the colored sign. `none`, `currentColor`, a gradient and a transparent paint are no color.
 */
function iconColorOf(svg: string): number | undefined {
    let best: { color: number; chroma: number } | undefined;
    for (const [, value] of svg.matchAll(PAINT)) {
        const rgba = parseCssColor(value.replace(/^["']|["']$/g, "").trim());
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
export function gutterIconGlyphOf(content: string | null): IGutterIconGlyph {
    if (content === null || !/<svg\b/i.test(content)) return { glyph: DOT_GLYPH };
    const shapes = [...content.matchAll(SHAPE)].map(([, tag, attributes]) => ({ tag: tag.toLowerCase(), attributes }));
    let glyph = DOT_GLYPH;
    if (shapes.length === 1) {
        const [{ tag, attributes }] = shapes;
        if (tag === "rect" && isBar(attributes)) glyph = BAR_GLYPH;
        else if ((tag === "polygon" || tag === "path") && isTriangle(tag, attributes)) glyph = TRIANGLE_GLYPH;
    }
    const color = iconColorOf(content);
    return color === undefined ? { glyph } : { glyph, color };
}

/** The icon's text: a `data:` URI's payload as is, a file through `readFile`; a failed read is `null`. */
export async function gutterIconContentOf(uri: string, readFile: GutterIconReader): Promise<string | null> {
    try {
        const parsed = Uri.parse(uri);
        if (parsed.scheme !== "data") return new TextDecoder().decode(await readFile(parsed));
        // An unencoded `#` (`fill='#f00'`) splits the URI into a fragment; the payload is the whole of it.
        const query = parsed.query === "" ? "" : `?${parsed.query}`;
        const fragment = parsed.fragment === "" ? "" : `#${parsed.fragment}`;
        const raw = parsed.path + query + fragment;
        const comma = raw.indexOf(",");
        if (comma < 0) return null;
        const payload = raw.slice(comma + 1);
        return /;base64$/i.test(raw.slice(0, comma)) ? Buffer.from(payload, "base64").toString("utf8") : payload;
    } catch {
        return null;
    }
}
