import * as fs from "node:fs";
import * as path from "node:path";

import { writeNpmProject } from "./npmProject.ts";

// A Tailwind v4 project: the server starts only on a CSS file that imports Tailwind (or a v3 config), and
// loads `tailwindcss` from the project. `@source inline` gives the CSS file a "Generates N classes" lens.

const APP_CSS = `@import "tailwindcss";
@source inline("bg-red-{50,{100..900..100},950}");
`;

/**
 * The class list of line 1: `p-4` and `p-6` conflict, and an arbitrary color goes through the color provider
 * (a named one goes as a `before` decoration with the color in `renderOptions` — line 3).
 */
export const TAILWIND_CLASSES = "flex p-4 p-6 bg-[#ff0000]";

/** A named color: its square is a `setDecorations` swatch, not a color provider's. */
export const TAILWIND_NAMED_COLOR_CLASS = "bg-red-500";

/** Line 2: an empty class list to type into. */
const INDEX_HTML = `<div class="${TAILWIND_CLASSES}">hi</div>
<p class=""></p>
<span class="${TAILWIND_NAMED_COLOR_CLASS}"></span>
`;

/** The class list of line 1 starts after this many characters. */
export const TAILWIND_CLASSES_COLUMN = '<div class="'.length;
/** A column inside `p-4` on line 1. */
export const TAILWIND_P4_COLUMN = TAILWIND_CLASSES_COLUMN + "flex p".length;
/** The caret goes between the quotes of line 2 after this many characters. */
export const TAILWIND_EMPTY_CLASS_COLUMN = '<p class="'.length;

/** Returns the path of `index.html`; `app.css` lies next to it. */
export function writeTailwindProject(projectRoot: string): string {
    writeNpmProject(projectRoot, "tailwindcss");
    fs.writeFileSync(path.join(projectRoot, "app.css"), APP_CSS);
    const html = path.join(projectRoot, "index.html");
    fs.writeFileSync(html, INDEX_HTML);
    return html;
}
