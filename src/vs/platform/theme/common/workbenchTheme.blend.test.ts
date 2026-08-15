import { describe, expect, it } from "vitest";

import { blendRgb, packRgb } from "@tuidom/core/common/colorUtils";
import { darkModernTheme } from "../../../workbench/services/themes/common/themes/darkModern.ts";
import { darkPlusTheme } from "../../../workbench/services/themes/common/themes/darkPlus.ts";
import { lightModernTheme } from "../../../workbench/services/themes/common/themes/lightModern.ts";

import type { IThemeFile } from "./iThemeFile.ts";
import { WorkbenchTheme } from "./workbenchTheme.ts";

function themeWith(colors: Record<string, string>): WorkbenchTheme {
    const json: IThemeFile = { name: "Blend Fixture", type: "dark", colors };
    return WorkbenchTheme.fromThemeFile(json);
}

/**
 * `blendOver` — единственная уступка альфе в палитре: терминал прозрачности не
 * умеет, а темы приезжают из upstream как есть и везут `#RRGGBBAA`. Носитель —
 * `statusBarItem.hoverBackground` поверх `statusBar.background`.
 */
describe("WorkbenchTheme — композитинг цветов с blendOver", () => {
    it("полупрозрачное значение темы накладывается на подложку", () => {
        const theme = themeWith({
            "statusBar.background": "#181818",
            "statusBarItem.hoverBackground": "#F1F1F133",
        });

        expect(theme.getRequiredColor("statusBarItem.hoverBackground")).toBe(
            blendRgb(packRgb(0xf1, 0xf1, 0xf1), packRgb(0x18, 0x18, 0x18), 0x33 / 0xff),
        );
    });

    it("подложка берётся из темы, а не из дефолтов реестра", () => {
        const overDark = themeWith({ "statusBar.background": "#000000", "statusBarItem.hoverBackground": "#FFFFFF80" });
        const overLight = themeWith({ "statusBar.background": "#FFFFFF", "statusBarItem.hoverBackground": "#FFFFFF80" });

        expect(overDark.getRequiredColor("statusBarItem.hoverBackground")).not.toBe(
            overLight.getRequiredColor("statusBarItem.hoverBackground"),
        );
        expect(overLight.getRequiredColor("statusBarItem.hoverBackground")).toBe(packRgb(255, 255, 255));
    });

    it("непрозрачное значение темы проходит как есть", () => {
        const theme = themeWith({ "statusBar.background": "#181818", "statusBarItem.hoverBackground": "#323233" });

        expect(theme.getRequiredColor("statusBarItem.hoverBackground")).toBe(packRgb(0x32, 0x32, 0x33));
    });

    it("тема без своего значения остаётся на запечённом дефолте", () => {
        // Dark+ (дефолтная тема тестов) hover-фон не задаёт.
        const theme = WorkbenchTheme.fromThemeFile(darkPlusTheme);

        expect(theme.getRequiredColor("statusBarItem.hoverBackground")).toBe(packRgb(0x1e, 0x92, 0xd2));
    });

    it("во встроенных темах hover-фон читаемо отличается от фона полосы", () => {
        for (const file of [darkModernTheme, lightModernTheme, darkPlusTheme]) {
            const theme = WorkbenchTheme.fromThemeFile(file);
            const hover = theme.getRequiredColor("statusBarItem.hoverBackground");
            const bar = theme.getRequiredColor("statusBar.background");
            const fg = theme.getRequiredColor("statusBarItem.hoverForeground");

            expect(hover).not.toBe(bar);
            // Главное, что ловит blendOver: без композитинга Dark Modern дал бы
            // почти белый фон под белым же текстом.
            expect(hover).not.toBe(fg);
        }
    });
});
