import { compositeOver, unpackB, unpackG, unpackR } from "@tuidom/core/common/colorUtils";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";

import type { WorkbenchTheme } from "../common/workbenchTheme.ts";

/** Вся палитра — в корневой var-scope одним вызовом; hot-swap темы — повторный вызов, каскад перерезолвит дерево сам. */
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

    // Строка меню: у tuidom это собственные токены `menuBar.*` (в темах VS Code
    // такого ключа нет — с кастомным заголовком меню рисуется на цветах
    // titleBar). Без моста строка оставалась бы на дефолте tuidom в любой теме.
    if ("titleBar.activeBackground" in vars) {
        vars["menuBar.background"] = vars["titleBar.activeBackground"];
    }
    if ("titleBar.activeForeground" in vars) {
        vars["menuBar.foreground"] = vars["titleBar.activeForeground"];
    }
    // Рамка меню, сливающаяся с его фоном: темы вроде Catppuccin задают
    // `menu.border` цветом фона (`#1e1e2e80` поверх `#1e1e2e`) и отделяют меню
    // от окна тенью `box-shadow`. Тени в TUI нет, а меню того же цвета, что
    // редактор, без рамки растворяется в нём — поэтому рамка берёт цвет
    // разделителя пунктов: он в той же теме заведомо виден на фоне меню.
    if ("menu.border" in vars && "menu.background" in vars && "menu.separatorBackground" in vars) {
        if (isInvisibleOn(vars["menu.border"], vars["menu.background"])) {
            vars["menu.border"] = vars["menu.separatorBackground"];
        }
    }

    return vars;
}

/** Порог различимости рамки на поверхности — макс. разница канала (0–255). */
const BORDER_VISIBILITY_THRESHOLD = 8;

/** Альфа рамки накладывается на непрозрачную поверхность. */
function isInvisibleOn(border: number, surface: number): boolean {
    const painted = compositeOver(border, surface);
    const delta = Math.max(
        Math.abs(unpackR(painted) - unpackR(surface)),
        Math.abs(unpackG(painted) - unpackG(surface)),
        Math.abs(unpackB(painted) - unpackB(surface)),
    );
    return delta < BORDER_VISIBILITY_THRESHOLD;
}
