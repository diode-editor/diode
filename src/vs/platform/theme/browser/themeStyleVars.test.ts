import { packRgba } from "@tuidom/core/common/colorUtils";
import { STYLE_TOKEN_DEFAULTS } from "@tuidom/core/dom/styles/styleTokens";
import { ROOT_STYLE_CONTEXT } from "@tuidom/core/dom/styles/tuiStyle";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { describe, expect, it } from "vitest";

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

    it("строка меню красится цветами titleBar темы (menuBar.* — токены tuidom без ключа в темах VS Code)", () => {
        const root = new BodyElement();
        root.setAsRoot();
        const theme = WorkbenchTheme.fromThemeFile({
            name: "mocha-like",
            type: "dark",
            colors: { "titleBar.activeBackground": "#11111B", "titleBar.activeForeground": "#CDD6F4" },
        });
        applyThemeVars(root, theme);
        root.performStyleResolution(ROOT_STYLE_CONTEXT);

        expect(root.styleVar("menuBar.background")).toBe(0x11111b);
        expect(root.styleVar("menuBar.foreground")).toBe(0xcdd6f4);
    });

    it("тема без titleBar.* — строка меню на дефолтах VS Code для заголовка, а не tuidom", () => {
        const root = new BodyElement();
        root.setAsRoot();
        applyThemeVars(root, WorkbenchTheme.fromThemeFile({ name: "bare", type: "light", colors: {} }));
        root.performStyleResolution(ROOT_STYLE_CONTEXT);

        expect(root.styleVar("menuBar.background")).toBe(0xdddddd);
        expect(root.styleVar("menuBar.foreground")).toBe(0x333333);
    });

    it("рамка меню цвета его фона (Catppuccin: menu.border = фон с альфой) берёт цвет разделителя", () => {
        const root = new BodyElement();
        root.setAsRoot();
        const theme = WorkbenchTheme.fromThemeFile({
            name: "mocha-like",
            type: "dark",
            colors: {
                "menu.background": "#1E1E2E",
                "menu.border": "#1E1E2E80",
                "menu.separatorBackground": "#585B70",
            },
        });
        applyThemeVars(root, theme);
        root.performStyleResolution(ROOT_STYLE_CONTEXT);

        expect(root.styleVar("menu.border")).toBe(0x585b70);
    });

    it("прозрачная и почти неотличимая рамка меню — тот же откат; заметная остаётся своей", () => {
        const border = (menuBorder: string): number => {
            const root = new BodyElement();
            root.setAsRoot();
            const theme = WorkbenchTheme.fromThemeFile({
                name: "t",
                type: "dark",
                colors: {
                    "menu.background": "#202020",
                    "menu.border": menuBorder,
                    "menu.separatorBackground": "#808080",
                },
            });
            applyThemeVars(root, theme);
            root.performStyleResolution(ROOT_STYLE_CONTEXT);
            return root.styleVar("menu.border");
        };

        expect(border("#00000000")).toBe(0x808080); // прозрачная
        expect(border("#272727")).toBe(0x808080); // разница каналов 7 < порога 8
        expect(border("#282828")).toBe(0x282828); // разница 8 — различима
        // Полупрозрачный белый над #202020 даёт +28 по каналам — различим, остаётся как есть (с альфой).
        expect(border("#FFFFFF20")).toBe(packRgba(255, 255, 255, 0x20));
    });

    it("палитра без titleBar.* вовсе (собрана руками) — мост молчит, строка меню на дефолте tuidom", () => {
        const base = WorkbenchTheme.fromThemeFile({ name: "no-titlebar", type: "dark", colors: {} });
        const colors = { ...base.colors };
        delete colors["titleBar.activeBackground"];
        delete colors["titleBar.activeForeground"];
        const root = new BodyElement();
        root.setAsRoot();
        applyThemeVars(root, new WorkbenchTheme("no-titlebar", "dark", colors, base.tokenTheme));
        root.performStyleResolution(ROOT_STYLE_CONTEXT);

        expect(root.styleVar("menuBar.background")).toBe(STYLE_TOKEN_DEFAULTS["menuBar.background"]);
        expect(root.styleVar("menuBar.foreground")).toBe(STYLE_TOKEN_DEFAULTS["menuBar.foreground"]);
    });
});

describe("applyThemeVars — не-числовые значения пропускаются", () => {
    it("undefined-цвет темы не попадает в таблицу (остаётся дефолт tuidom)", () => {
        const base = WorkbenchTheme.fromThemeFile({ name: "t", type: "dark", colors: {} });
        const colors = { ...base.colors, "list.hoverForeground": undefined } as typeof base.colors;
        const theme = new WorkbenchTheme("t", "dark", colors, base.tokenTheme);
        const root = new BodyElement();
        root.setAsRoot();
        expect(() => {
            applyThemeVars(root, theme);
        }).not.toThrow();
    });
});
