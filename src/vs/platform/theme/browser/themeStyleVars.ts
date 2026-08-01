import type { TUIElement } from "../../../../../tuidom/dom/tuiElement.ts";
import type { WorkbenchTheme } from "../common/workbenchTheme.ts";

/**
 * Единственная точка доставки темы в виджеты (Н3): вся палитра активной темы
 * кладётся в корневой var-scope tuidom одним вызовом. Виджеты ссылаются на
 * токены по именам color id VS Code; ключи, которых нет ни в теме, ни в
 * дефолтах реестра, остаются на дефолтах tuidom (STYLE_TOKEN_DEFAULTS).
 * Hot-swap темы = повторный вызов — каскад перерезолвит дерево сам.
 */
export function applyThemeVars(root: TUIElement, theme: WorkbenchTheme): void {
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

    root.setStyleVars(vars);
}
