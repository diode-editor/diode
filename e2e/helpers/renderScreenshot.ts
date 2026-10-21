import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Resvg } from "@resvg/resvg-js";

import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";
import { gridToSvg, type GridToSvgOptions } from "@tuidom/core/rendering/gridToSvg";

// Растеризация — только тулинг e2e, в бандл редактора не попадает. PNG, а не SVG: SVG в теле
// PR GitHub не рендерит.

const here = fileURLToPath(new URL(".", import.meta.url));

export const screenshotsDir = resolve(here, "..", "..", "screenshots");

// A Nerd Font so the editor's codicon glyphs (file tree, status bar) render.
const DEFAULT_FONT = "Hack Nerd Font Mono";

// Шрифты вендорены в `e2e/fonts/`: в dev-контейнерах и на CI системных шрифтов нет (`fc-list` пуст).
// Порядок важен — resvg берёт первый шрифт с глифом: Hack несёт текст и codicon'ы, DejaVu Sans —
// фоллбэк (блок Брайля U+2800 спиннера); без него глиф выходит пустым `.notdef`.
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
