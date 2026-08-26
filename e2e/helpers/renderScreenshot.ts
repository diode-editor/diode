import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Resvg } from "@resvg/resvg-js";

import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";
import { gridToSvg, type GridToSvgOptions } from "@tuidom/core/rendering/gridToSvg";

// Screenshot rasterization is tooling only — it lives here in `e2e/`, never in the
// editor bundle. The editor emits plain data (`GridSnapshot`); `gridToSvg` turns it
// into a dependency-free SVG; resvg (a native devDependency) turns the SVG into a
// PNG using a system font. GitHub renders PNGs in PR bodies; SVG it would not.

const here = fileURLToPath(new URL(".", import.meta.url));

/** Repo-root `screenshots/` directory (git-ignored). */
export const screenshotsDir = resolve(here, "..", "..", "screenshots");

// A Nerd Font so the editor's codicon glyphs (file tree, status bar) render.
const DEFAULT_FONT = "Hack Nerd Font Mono";

// Fonts are vendored in `e2e/fonts/` and loaded explicitly, so screenshots render
// identical glyphs everywhere — ephemeral dev containers and CI runners ship no
// system fonts at all (`fc-list` is empty), so `loadSystemFonts` is a courtesy for
// developer machines, never something to rely on.
//
// Two families, in this order: Hack Nerd Font Mono carries the text and the codicon
// glyphs; DejaVu Sans is a fallback for what Hack lacks — notably the Braille block
// (U+2800), which the progress spinner is drawn from (`SPINNER_FRAMES`). resvg picks
// the first font that covers a glyph, so Hack keeps everything it has. Without the
// fallback missing glyphs come out as an empty `.notdef` box — invisible to string
// assertions, which is why `renderScreenshot.test.ts` gates it.
const fontsDir = resolve(here, "..", "fonts");
export const BUNDLED_FONT_FILES = [
    "HackNerdFontMono-Regular.ttf",
    "HackNerdFontMono-Bold.ttf",
    "HackNerdFontMono-Italic.ttf",
    "HackNerdFontMono-BoldItalic.ttf",
    "DejaVuSans.ttf",
].map((name) => resolve(fontsDir, name));

/** Rasterize a captured frame to a PNG buffer. */
export function renderSnapshotToPng(snapshot: GridSnapshot, options: GridToSvgOptions = {}): Buffer {
    const fontFamily = options.fontFamily ?? DEFAULT_FONT;
    const svg = gridToSvg(snapshot, { ...options, fontFamily });
    const resvg = new Resvg(svg, {
        font: { loadSystemFonts: true, fontFiles: BUNDLED_FONT_FILES, defaultFontFamily: fontFamily },
    });
    return Buffer.from(resvg.render().asPng());
}

/** Render a frame and write it to `screenshots/<name>.png`; returns the path. */
export function saveScreenshot(name: string, snapshot: GridSnapshot, options?: GridToSvgOptions): string {
    mkdirSync(screenshotsDir, { recursive: true });
    const fileName = name.endsWith(".png") ? name : `${name}.png`;
    const path = resolve(screenshotsDir, fileName);
    writeFileSync(path, renderSnapshotToPng(snapshot, options));
    return path;
}
