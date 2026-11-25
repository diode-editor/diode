import { compositeOver, unpackB, unpackG, unpackR } from "@tuidom/core/common/colorUtils";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";

import type { WorkbenchTheme } from "../common/workbenchTheme.ts";

/** Puts the whole palette into the root var scope in one call; a theme hot-swap is another call, the cascade re-resolves the tree. */
export function applyThemeVars(root: TUIElement, theme: WorkbenchTheme): void {
    root.setStyleVars(computeThemeVars(theme));
}

export function computeThemeVars(theme: WorkbenchTheme): Record<string, number> {
    const vars: Record<string, number> = {};
    for (const [key, value] of Object.entries(theme.colors)) {
        if (typeof value === "number") {
            vars[key] = value;
        }
    }

    // Menu bar: tuidom has its own `menuBar.*` tokens (VS Code themes have no such key; with a
    // custom title bar the menu is painted in titleBar colors). Without the bridge the bar would
    // stay on the tuidom default in every theme.
    if ("titleBar.activeBackground" in vars) {
        vars["menuBar.background"] = vars["titleBar.activeBackground"];
    }
    if ("titleBar.activeForeground" in vars) {
        vars["menuBar.foreground"] = vars["titleBar.activeForeground"];
    }
    // Frame lines are one color (docs/arch/workbench/Frames.md): the tabs' boxes and baseline are the
    // top of the editor group's frame, whose sides and bottom are `panel.border`. tuidom's tab strip
    // paints `tab.border`, so the var takes the frame color; the theme's own `tab.border` (Monokai,
    // Catppuccin: almost the background) would leave the frame's top darker than its sides. Only
    // the var scope: the registered color, which themes and the API read, keeps the theme's value.
    // `panel.border` has a registry default, so every theme has it.
    vars["tab.border"] = vars["panel.border"];
    // Menu border that blends into its background: themes like Catppuccin set `menu.border` to the
    // background color (`#1e1e2e80` over `#1e1e2e`) and separate the menu from the window with a
    // `box-shadow`. A TUI has no shadow, and a borderless menu the same color as the editor
    // dissolves into it, so the border takes the item separator color: in the same theme it is
    // surely visible against the menu background.
    if ("menu.border" in vars && "menu.background" in vars && "menu.separatorBackground" in vars) {
        if (isInvisibleOn(vars["menu.border"], vars["menu.background"])) {
            vars["menu.border"] = vars["menu.separatorBackground"];
        }
    }

    return vars;
}

/** Threshold for a border to be distinguishable on a surface: max channel difference (0–255). */
const BORDER_VISIBILITY_THRESHOLD = 8;

/** The border alpha is composited over the opaque surface. */
function isInvisibleOn(border: number, surface: number): boolean {
    const painted = compositeOver(border, surface);
    const delta = Math.max(
        Math.abs(unpackR(painted) - unpackR(surface)),
        Math.abs(unpackG(painted) - unpackG(surface)),
        Math.abs(unpackB(painted) - unpackB(surface)),
    );
    return delta < BORDER_VISIBILITY_THRESHOLD;
}
