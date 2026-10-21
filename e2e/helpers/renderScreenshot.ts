import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Resvg } from "@resvg/resvg-js";

import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";
import { gridToSvg, type GridToSvgOptions } from "@tuidom/core/rendering/gridToSvg";

// Rasterization is e2e tooling only and does not end up in the editor bundle. PNG, not SVG: GitHub does not
// render SVG in a PR body.

const here = fileURLToPath(new URL(".", import.meta.url));

export const screenshotsDir = resolve(here, "..", "..", "screenshots");

// A Nerd Font so the editor's codicon glyphs (file tree, status bar) render.
const DEFAULT_FONT = "Hack Nerd Font Mono";

// Fonts are vendored in `e2e/fonts/`: dev containers and CI have no system fonts (`fc-list` is empty).
// Order matters — resvg takes the first font with the glyph: Hack covers text and codicons, DejaVu Sans is
// the fallback (the spinner's Braille block U+2800); without it the glyph renders as an empty `.notdef`.
const fontsDir = resolve(here, "..", "fonts");
export const BUNDLED_FONT_FILES = [
    "HackNerdFontMono-Regular.ttf",
    "HackNerdFontMono-Bold.ttf",
    "HackNerdFontMono-Italic.ttf",
    "HackNerdFontMono-BoldItalic.ttf",
    "DejaVuSans.ttf",
].map((name) => resolve(fontsDir, name));

export function renderSnapshotToPng(snapshot: GridSnapshot, options: GridToSvgOptions = {}): Buffer {
    const fontFamily = options.fontFamily ?? DEFAULT_FONT;
    const svg = gridToSvg(snapshot, { ...options, fontFamily });
    const resvg = new Resvg(svg, {
        font: { loadSystemFonts: true, fontFiles: BUNDLED_FONT_FILES, defaultFontFamily: fontFamily },
    });
    return Buffer.from(resvg.render().asPng());
}

export function saveScreenshot(name: string, snapshot: GridSnapshot, options?: GridToSvgOptions): string {
    mkdirSync(screenshotsDir, { recursive: true });
    const fileName = name.endsWith(".png") ? name : `${name}.png`;
    const path = resolve(screenshotsDir, fileName);
    writeFileSync(path, renderSnapshotToPng(snapshot, options));
    return path;
}
