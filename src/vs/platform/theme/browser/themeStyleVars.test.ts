import { describe, expect, it } from "vitest";

import { ROOT_STYLE_CONTEXT } from "../../../../../tuidom/dom/styles/tuiStyle.ts";
import { BodyElement } from "../../../../../tuidom/ui/body/bodyElement.ts";
import { darkPlusTheme } from "../../../workbench/services/themes/common/themes/darkPlus.ts";
import { WorkbenchTheme } from "../common/workbenchTheme.ts";

import { applyThemeVars } from "./themeStyleVars.ts";

function themeWithoutTerminalColors(): WorkbenchTheme {
    const base = WorkbenchTheme.fromThemeFile({ name: "no-terminal-colors", type: "dark", colors: {} });
    const colors = { ...base.colors };
    delete colors["terminal.background"];
    delete colors["terminal.foreground"];
    colors["panel.background"] = 0x111111;
    colors["editor.foreground"] = 0x222222;
    return new WorkbenchTheme("no-terminal-colors", "dark", colors, base.tokenTheme);
}

describe("applyThemeVars — тема → корневой var-scope", () => {
    it("вся палитра доступна виджетам через styleVar", () => {
        const root = new BodyElement();
        root.setAsRoot();
        const theme = WorkbenchTheme.fromThemeFile(darkPlusTheme);
        applyThemeVars(root, theme);
        root.performStyleResolution(ROOT_STYLE_CONTEXT);

        expect(root.styleVar("panel.background")).toBe(theme.getRequiredColor("panel.background"));
        expect(root.styleVar("terminal.background")).toBe(theme.getRequiredColor("terminal.background"));
    });

    it("терминал без своих цветов темы наследует panel/editor (бывший фоллбэк моста)", () => {
        const root = new BodyElement();
        root.setAsRoot();
        applyThemeVars(root, themeWithoutTerminalColors());
        root.performStyleResolution(ROOT_STYLE_CONTEXT);

        expect(root.styleVar("terminal.background")).toBe(0x111111);
        expect(root.styleVar("terminal.foreground")).toBe(0x222222);
    });
});

describe("applyThemeVars — не-числовые значения пропускаются", () => {
    it("undefined-цвет темы не попадает в таблицу (остаётся дефолт tuidom)", () => {
        const base = WorkbenchTheme.fromThemeFile({ name: "t", type: "dark", colors: {} });
        const colors = { ...base.colors, "list.hoverForeground": undefined } as typeof base.colors;
        const theme = new WorkbenchTheme("t", "dark", colors, base.tokenTheme);
        const root = new BodyElement();
        root.setAsRoot();
        expect(() => applyThemeVars(root, theme)).not.toThrow();
    });
});
