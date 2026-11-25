import { packRgba } from "@tuidom/core/common/colorUtils";
import { describe, expect, it } from "vitest";

import { Uri } from "../../../../../base/common/uri.ts";

import { gutterIconContentOf, gutterIconGlyphOf } from "./gutterIconGlyph.ts";

const rgb = (r: number, g: number, b: number) => packRgba(r, g, b, 255);

/** Error Lens 3.30 `img/default/error-dark.svg`: a dark backdrop circle before the colored sign. */
const ERROR_LENS_ERROR =
    '<svg xmlns="http://www.w3.org/2000/svg" height="30" width="30"><circle cx="15" cy="15" r="9" fill="#1e1e1e"/>' +
    '<path d="M15 7.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 1 0 0-15z" fill="#f48771"/><path d="M19.5 12L18 10.5z" fill="#252526"/></svg>';
/** Error Lens 3.30 `img/default/warning-dark.svg`: paths only, a hexagon-ish outline among them. */
const ERROR_LENS_WARNING =
    '<svg xmlns="http://www.w3.org/2000/svg" height="30" width="30"><path d="M13.615 6L6 21l2.77 3H21.23L24 21 16.385 6z" fill="#1e1e1e"/>' +
    '<path d="M15.692 7.5h-1.385L8.077 21z" fill="#fc0"/><path d="M15.692 18h-1.385v-6h1.385z"/></svg>';
/** Error Lens 3.30 `img/default/hint-dark.svg`: the paint of the root element comes first. */
const ERROR_LENS_HINT =
    '<svg width="30" height="30" viewBox="-2.9 -2.6 21 21" xmlns="http://www.w3.org/2000/svg" fill="#252526">\n' +
    '\t<circle cx="7.5" cy="7.5" r="6" fill="#2faf64" />\n\t<path fill-rule="evenodd" d="M7.5 1a6.5 6.5 0 1 0 0 13z"/>\n</svg>';
/** GitLens's heatmap bar. */
const GITLENS_BAR =
    "<svg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 18 18'><rect fill='rgb(255,128,0)' fill-opacity='0.5' x='8' y='0' width='3' height='18'/></svg>";

describe("gutterIconGlyphOf", () => {
    it("Error Lens's stock icons are dots of their sign's color, not of the gray backdrop", () => {
        expect(gutterIconGlyphOf(ERROR_LENS_ERROR)).toStrictEqual({ glyph: "●", color: rgb(0xf4, 0x87, 0x71) });
        expect(gutterIconGlyphOf(ERROR_LENS_WARNING)).toStrictEqual({ glyph: "●", color: rgb(0xff, 0xcc, 0x00) });
        expect(gutterIconGlyphOf(ERROR_LENS_HINT)).toStrictEqual({ glyph: "●", color: rgb(0x2f, 0xaf, 0x64) });
    });

    it("a single tall rect is a bar of its color", () => {
        expect(gutterIconGlyphOf(GITLENS_BAR)).toStrictEqual({ glyph: "▎", color: rgb(255, 128, 0) });
    });

    it("a square, a wide or a percent-sized rect, and a rect among other shapes are dots", () => {
        const rect = (w: string, h: string) => `<svg><rect width="${w}" height="${h}" fill="red"/></svg>`;
        expect(gutterIconGlyphOf(rect("10", "10")).glyph).toBe("●");
        expect(gutterIconGlyphOf(rect("18", "3")).glyph).toBe("●");
        expect(gutterIconGlyphOf(rect("3", "100%")).glyph).toBe("●");
        expect(gutterIconGlyphOf(rect("5", "10")).glyph).toBe("▎");
        expect(gutterIconGlyphOf(rect("5", "9.9")).glyph).toBe("●");
        expect(gutterIconGlyphOf(rect("0", "10")).glyph).toBe("●");
        expect(gutterIconGlyphOf('<svg><rect width="3" height="18"/><circle r="1"/></svg>').glyph).toBe("●");
    });

    it("a single triangle, polygon or straight-line path, is a ▸", () => {
        expect(gutterIconGlyphOf("<svg><polygon points='13,10 13,17 17,13.5' fill='#f00'/></svg>")).toStrictEqual({
            glyph: "▸",
            color: rgb(255, 0, 0),
        });
        expect(gutterIconGlyphOf("<svg><polygon points='0,0 4,2 0,4 0,0'/></svg>").glyph).toBe("▸");
        expect(gutterIconGlyphOf('<svg><path d="M0 0 L4 2 L0 4 Z"/></svg>').glyph).toBe("▸");
        expect(gutterIconGlyphOf('<svg><path d="m0 0l4 2-4 2z"/></svg>').glyph).toBe("▸");
        // A square, a curve, a polygon that does not close on its start.
        expect(gutterIconGlyphOf("<svg><polygon points='0,0 4,0 4,4 0,4'/></svg>").glyph).toBe("●");
        expect(gutterIconGlyphOf('<svg><path d="M0 0 Q4 2 0 4 Z"/></svg>').glyph).toBe("●");
        expect(gutterIconGlyphOf("<svg><polygon points='0,0 4,2 0,4 1,1'/></svg>").glyph).toBe("●");
        expect(gutterIconGlyphOf("<svg><polygon points='0,0 4,2 0,4 0,1'/></svg>").glyph).toBe("●");
        expect(gutterIconGlyphOf("<svg><polygon points='0,0 4,2 0,4 1,0'/></svg>").glyph).toBe("●");
        expect(gutterIconGlyphOf("<svg><polygon points='0,0 4,2 0,4 0,0 2,2'/></svg>").glyph).toBe("●");
        expect(gutterIconGlyphOf("<svg><polygon points='10,20 40,25 10,30'/></svg>").glyph).toBe("▸");
        expect(gutterIconGlyphOf("<svg><polygon points='10,20 40,25 10,30 10,20'/></svg>").glyph).toBe("▸");
        expect(gutterIconGlyphOf("<svg><polygon/></svg>").glyph).toBe("●");
        expect(gutterIconGlyphOf("<svg><polyline points='0,0 4,2 0,4'/></svg>").glyph).toBe("●");
        // Only a polygon's points and a path's d are its outline; another attribute named alike is not.
        expect(gutterIconGlyphOf('<svg><polyline d="M0 0 L4 2 L0 4 Z"/></svg>').glyph).toBe("●");
        expect(gutterIconGlyphOf('<svg><path id="M0 0 L4 2 L0 4 Z"/></svg>').glyph).toBe("●");
        expect(gutterIconGlyphOf("<svg><polygon data-points='0,0 4,2 0,4'/></svg>").glyph).toBe("●");
    });

    it("the color is the first most saturated paint: stroke and CSS fill count, none and garbage do not", () => {
        expect(gutterIconGlyphOf('<svg><circle stroke="#00f" fill="none"/></svg>').color).toBe(rgb(0, 0, 255));
        expect(gutterIconGlyphOf('<svg><circle style="fill: lime; stroke: red"/></svg>').color).toBe(rgb(0, 255, 0));
        expect(gutterIconGlyphOf("<svg><circle style='fill: #f00 ; stroke: none'/></svg>").color).toBe(rgb(255, 0, 0));
        expect(gutterIconGlyphOf('<svg><circle fill="currentColor"/><path fill="transparent"/></svg>')).toStrictEqual({
            glyph: "●",
        });
        expect(gutterIconGlyphOf('<svg><circle fill="#808080"/><circle fill="#ffffff"/></svg>').color).toBe(
            rgb(128, 128, 128),
        );
    });

    it("not an SVG, or nothing read, is a dot without a color", () => {
        expect(gutterIconGlyphOf("")).toStrictEqual({ glyph: "●" });
        expect(gutterIconGlyphOf("\u0089PNG\r\n\u001a\n fill='#f00'")).toStrictEqual({ glyph: "●" });
    });
});

describe("gutterIconContentOf", () => {
    const noRead = () => Promise.reject(new Error("must not read"));

    it("a data: URI is its payload, percent-encoded, raw with a # in it, or base64", async () => {
        const svg = "<svg><rect fill='#f00'/></svg>";
        const encoded = Uri.parse(`data:image/svg+xml,${encodeURIComponent(svg)}`).toString();
        expect(await gutterIconContentOf(encoded, noRead)).toBe(svg);
        expect(await gutterIconContentOf(Uri.parse(`data:image/svg+xml,${svg}`).toString(), noRead)).toBe(svg);
        const base64 = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
        expect(await gutterIconContentOf(base64, noRead)).toBe(svg);
        expect(await gutterIconContentOf("data:image/svg+xml?x=1,<svg/>", noRead)).toBe("<svg/>");
        expect(await gutterIconContentOf("data:,<svg/>", noRead)).toBe("<svg/>");
    });

    it("a data: URI without a payload is nothing", async () => {
        expect(await gutterIconContentOf("data:image/svg+xml", noRead)).toBe("");
    });

    it("a file is read through the reader; a failed read is nothing", async () => {
        const read = (resource: Uri) =>
            resource.path === "/i.svg"
                ? Promise.resolve(new TextEncoder().encode("<svg/>"))
                : Promise.reject(new Error("ENOENT"));
        expect(await gutterIconContentOf(Uri.file("/i.svg").toString(), read)).toBe("<svg/>");
        expect(await gutterIconContentOf(Uri.file("/gone.svg").toString(), read)).toBe("");
    });
});
