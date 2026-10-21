import { packRgba } from "@tuidom/core/common/colorUtils";
import { STYLE_TOKEN_DEFAULTS } from "@tuidom/core/dom/styles/styleTokens";
import { ROOT_STYLE_CONTEXT } from "@tuidom/core/dom/styles/tuiStyle";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { describe, expect, it } from "vitest";

import { darkPlusTheme } from "../../../workbench/services/themes/common/themes/darkPlus.ts";
import { WorkbenchTheme } from "../common/workbenchTheme.ts";

import { applyThemeVars, computeThemeVars } from "./themeStyleVars.ts";

describe("applyThemeVars: theme → root var-scope", () => {
    it("the whole palette is available to widgets via styleVar", () => {
        const root = new BodyElement();
        root.setAsRoot();
        const theme = WorkbenchTheme.fromThemeFile(darkPlusTheme);
        applyThemeVars(root, theme);
        root.performStyleResolution(ROOT_STYLE_CONTEXT);

        expect(root.styleVar("panel.background")).toBe(theme.getRequiredColor("panel.background"));
        expect(root.styleVar("terminal.background")).toBe(theme.getRequiredColor("terminal.background"));
    });

    it("a terminal without its own theme colors uses the panel background, as in VS Code, not the default dark one", () => {
        const root = new BodyElement();
        root.setAsRoot();
        const theme = WorkbenchTheme.fromThemeFile({
            name: "panel-only",
            type: "dark",
            colors: { "panel.background": "#1E1E2E" },
        });
        applyThemeVars(root, theme);
        root.performStyleResolution(ROOT_STYLE_CONTEXT);

        expect(root.styleVar("terminal.background")).toBe(0x1e1e2e);
    });

    it("the theme's own terminal.background wins over the panel background", () => {
        const root = new BodyElement();
        root.setAsRoot();
        const theme = WorkbenchTheme.fromThemeFile({
            name: "own-terminal",
            type: "light",
            colors: { "panel.background": "#EEEEEE", "terminal.background": "#FFFFFF" },
        });
        applyThemeVars(root, theme);
        root.performStyleResolution(ROOT_STYLE_CONTEXT);

        expect(root.styleVar("terminal.background")).toBe(0xffffff);
    });

    it("the menu bar uses the theme's titleBar colors (menuBar.* are tuidom tokens with no key in VS Code themes)", () => {
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

    it("a theme without titleBar.*: the menu bar uses VS Code's title bar defaults, not tuidom's", () => {
        const root = new BodyElement();
        root.setAsRoot();
        applyThemeVars(root, WorkbenchTheme.fromThemeFile({ name: "bare", type: "light", colors: {} }));
        root.performStyleResolution(ROOT_STYLE_CONTEXT);

        expect(root.styleVar("menuBar.background")).toBe(0xdddddd);
        expect(root.styleVar("menuBar.foreground")).toBe(0x333333);
    });

    it("a menu border the color of its background (Catppuccin: menu.border = background with alpha) takes the separator color", () => {
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

    it("a transparent or nearly indistinguishable menu border gets the same fallback; a visible one stays", () => {
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

        expect(border("#00000000")).toBe(0x808080); // transparent
        expect(border("#272727")).toBe(0x808080); // channel difference 7 < threshold 8
        expect(border("#282828")).toBe(0x282828); // difference 8: distinguishable
        expect(border("#202030")).toBe(0x202030); // distinguishable by one channel: max counts, not min
        // Translucent white over #202020 gives +28 per channel: distinguishable, kept as is (with alpha).
        expect(border("#FFFFFF20")).toBe(packRgba(255, 255, 255, 0x20));
    });

    it("a palette without menu.* (built by hand): the menu border bridge stays silent", () => {
        const base = WorkbenchTheme.fromThemeFile({
            name: "no-menu",
            type: "dark",
            colors: { "menu.border": "#20202080" },
        });
        for (const missing of ["menu.border", "menu.background", "menu.separatorBackground"] as const) {
            const colors = { ...base.colors };
            colors[missing] = undefined;
            const vars = computeThemeVars(new WorkbenchTheme("no-menu", "dark", colors, base.tokenTheme));
            expect(vars["menu.border"], missing).toBe(colors["menu.border"]);
        }
    });

    it("a palette with no titleBar.* at all (built by hand): the bridge stays silent, the menu bar keeps the tuidom default", () => {
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

describe("applyThemeVars: non-numeric values are skipped", () => {
    it("an undefined theme color does not reach the table (the tuidom default stays)", () => {
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
