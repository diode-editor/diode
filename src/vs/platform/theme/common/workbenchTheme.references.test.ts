import { packRgb } from "@tuidom/core/common/colorUtils";
import { describe, expect, it } from "vitest";

import { darkPlusTheme } from "../../../workbench/services/themes/common/themes/darkPlus.ts";

import { WorkbenchTheme } from "./workbenchTheme.ts";

/**
 * Дефолт-ссылка (`quickInput.background` → `editorWidget.background`, как
 * `registerColor(id, editorWidgetBackground)` у VS Code) разрешается поверх
 * цветов темы: тема, задавшая базовый ключ, получает и производные. Носитель —
 * Catppuccin: `editorWidget.background` задан (#181825), `quickInput.background`
 * нет, и пикер обязан быть цвета виджетов, а не запечённого серого.
 */
describe("WorkbenchTheme — производные дефолты по ссылке", () => {
    it("производный ключ следует за базовым из темы", () => {
        const theme = WorkbenchTheme.fromThemeFile({
            name: "mocha-like",
            type: "dark",
            colors: { "editorWidget.background": "#181825", "editorWidget.foreground": "#CDD6F4" },
        });

        expect(theme.getRequiredColor("quickInput.background")).toBe(packRgb(0x18, 0x18, 0x25));
        expect(theme.getRequiredColor("quickInput.foreground")).toBe(packRgb(0xcd, 0xd6, 0xf4));
        expect(theme.getRequiredColor("editorHoverWidget.background")).toBe(packRgb(0x18, 0x18, 0x25));
        expect(theme.getRequiredColor("notifications.background")).toBe(packRgb(0x18, 0x18, 0x25));
    });

    it("явное значение темы для производного ключа побеждает ссылку", () => {
        const theme = WorkbenchTheme.fromThemeFile({
            name: "explicit",
            type: "dark",
            colors: { "editorWidget.background": "#181825", "quickInput.background": "#222222" },
        });

        expect(theme.getRequiredColor("quickInput.background")).toBe(packRgb(0x22, 0x22, 0x22));
        expect(theme.getRequiredColor("editorHoverWidget.background")).toBe(packRgb(0x18, 0x18, 0x25));
    });

    it("цепочка ссылок: menu.selectionBackground → list.activeSelectionBackground → тема", () => {
        const theme = WorkbenchTheme.fromThemeFile({
            name: "chain",
            type: "light",
            colors: { "list.activeSelectionBackground": "#E8E8E8", foreground: "#101010" },
        });

        expect(theme.getRequiredColor("menu.selectionBackground")).toBe(packRgb(0xe8, 0xe8, 0xe8));
        // editorWidget.foreground → foreground → тема; dropdown.foreground (light) → foreground.
        expect(theme.getRequiredColor("editorWidget.foreground")).toBe(packRgb(0x10, 0x10, 0x10));
        expect(theme.getRequiredColor("menu.foreground")).toBe(packRgb(0x10, 0x10, 0x10));
    });

    it("без значений темы производные равны запечённым дефолтам VS Code (Dark+ не меняется)", () => {
        const bare = WorkbenchTheme.fromThemeFile({ name: "bare", type: "dark", colors: {} });
        expect(bare.getRequiredColor("quickInput.background")).toBe(packRgb(0x25, 0x25, 0x26));
        expect(bare.getRequiredColor("quickInput.foreground")).toBe(packRgb(0xcc, 0xcc, 0xcc));
        expect(bare.getRequiredColor("menu.background")).toBe(packRgb(0x3c, 0x3c, 0x3c));

        const darkPlus = WorkbenchTheme.fromThemeFile(darkPlusTheme);
        expect(darkPlus.getRequiredColor("quickInput.background")).toBe(packRgb(0x25, 0x25, 0x26));
        expect(darkPlus.getRequiredColor("menu.background")).toBe(packRgb(0x25, 0x25, 0x26));
    });

    it("значение темы, которое не hex и не ключ реестра, — ошибка с именем ссылающегося ключа", () => {
        expect(() =>
            WorkbenchTheme.fromThemeFile({ name: "bad", type: "dark", colors: { "editor.background": "red" } }),
        ).toThrow('Color "editor.background" refers to unknown color "red"');
        // По цепочке — виноват последний ссылающийся ключ, а не первый.
        expect(() =>
            WorkbenchTheme.fromThemeFile({
                name: "bad-chain",
                type: "dark",
                colors: { "editor.background": "editor.foreground", "editor.foreground": "nope" },
            }),
        ).toThrow('Color "editor.foreground" refers to unknown color "nope"');
    });

    it("цикл ссылок — ошибка с полной цепочкой, а не бесконечная рекурсия", () => {
        expect(() =>
            WorkbenchTheme.fromThemeFile({
                name: "cycle",
                type: "dark",
                colors: { "editor.background": "editor.foreground", "editor.foreground": "editor.background" },
            }),
        ).toThrow("Color reference cycle: editor.background → editor.foreground → editor.background");
    });
});
