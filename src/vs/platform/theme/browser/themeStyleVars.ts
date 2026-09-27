import { compositeOver, unpackB, unpackG, unpackR } from "@tuidom/core/common/colorUtils";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";

import type { WorkbenchTheme } from "../common/workbenchTheme.ts";

/**
 * Единственная точка доставки темы в виджеты (Н3): вся палитра активной темы
 * кладётся в корневой var-scope tuidom одним вызовом. Виджеты ссылаются на
 * токены по именам color id VS Code; ключи, которых нет ни в теме, ни в
 * дефолтах реестра, остаются на дефолтах tuidom (STYLE_TOKEN_DEFAULTS).
 * Hot-swap темы = повторный вызов — каскад перерезолвит дерево сам.
 */
export function applyThemeVars(root: TUIElement, theme: WorkbenchTheme): void {
    root.setStyleVars(computeThemeVars(theme));
}

/** Палитра темы как словарь var-scope: то, что applyThemeVars кладёт в корень.
 * Отдельно, чтобы тест-харнессы могли получить те же числа без элемента. */
export function computeThemeVars(theme: WorkbenchTheme): Record<string, number> {
    const vars: Record<string, number> = {};
    for (const [key, value] of Object.entries(theme.colors)) {
        if (typeof value === "number") {
            vars[key] = value;
        }
    }

    // Фоллбэки, раньше жившие в мостах defaultStyles.ts: терминал без
    // собственных цветов темы наследует панель/редактор. (Гуттер редактора —
    // третий такой случай — решается на месте чтения: styleVar с fallback.)
    if (!("terminal.background" in vars) && "panel.background" in vars) {
        vars["terminal.background"] = vars["panel.background"];
    }
    if (!("terminal.foreground" in vars) && "editor.foreground" in vars) {
        vars["terminal.foreground"] = vars["editor.foreground"];
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

/**
 * Рамка цвета `border` неразличима на поверхности `surface`: после наложения
 * (альфа рамки — на непрозрачную поверхность) каналы отличаются меньше порога.
 */
function isInvisibleOn(border: number, surface: number): boolean {
    const painted = compositeOver(border, surface);
    const delta = Math.max(
        Math.abs(unpackR(painted) - unpackR(surface)),
        Math.abs(unpackG(painted) - unpackG(surface)),
        Math.abs(unpackB(painted) - unpackB(surface)),
    );
    return delta < BORDER_VISIBILITY_THRESHOLD;
}
