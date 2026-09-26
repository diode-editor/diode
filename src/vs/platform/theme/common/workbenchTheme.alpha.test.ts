import {
    compositeOver,
    isTranslucent,
    packRgb,
    packRgba,
    TRANSPARENT_COLOR,
    unpackA,
} from "@tuidom/core/common/colorUtils";
import { describe, expect, it } from "vitest";

import { darkModernTheme } from "../../../workbench/services/themes/common/themes/darkModern.ts";
import { darkPlusTheme } from "../../../workbench/services/themes/common/themes/darkPlus.ts";
import { computeThemeVars } from "../browser/themeStyleVars.ts";

import { parseHexColor } from "./colorUtils.ts";
import type { IThemeFile } from "./iThemeFile.ts";
import { WorkbenchTheme } from "./workbenchTheme.ts";

function themeWith(colors: Record<string, string>): WorkbenchTheme {
    const json: IThemeFile = { name: "Alpha Fixture", type: "dark", colors };
    return WorkbenchTheme.fromThemeFile(json);
}

/**
 * С tuidom 0.4.0 альфа — штатная часть цвета: палитра несёт `#RRGGBBAA` как
 * есть, а композитинг выполняет движок в порядке отрисовки. Здесь — что тема
 * ничего не теряет по дороге в var-scope; сам композитинг закрывают тесты
 * tuidom (`grid.alpha.test.ts`) и кадровые тесты редактора.
 */
describe("WorkbenchTheme — цвета с альфой уходят в палитру как есть", () => {
    it("полупрозрачное значение темы остаётся полупрозрачным числом", () => {
        const theme = themeWith({ "statusBarItem.hoverBackground": "#F1F1F133" });
        const hover = theme.getRequiredColor("statusBarItem.hoverBackground");

        expect(hover).toBe(packRgba(0xf1, 0xf1, 0xf1, 0x33));
        expect(isTranslucent(hover)).toBe(true);
        expect(unpackA(hover)).toBe(0x33);
    });

    it("подложка при этом не участвует в парсинге — наложение делает движок при отрисовке", () => {
        const overDark = themeWith({ "statusBar.background": "#000000", "statusBarItem.hoverBackground": "#FFFFFF80" });
        const overLight = themeWith({
            "statusBar.background": "#FFFFFF",
            "statusBarItem.hoverBackground": "#FFFFFF80",
        });

        expect(overDark.getRequiredColor("statusBarItem.hoverBackground")).toBe(
            overLight.getRequiredColor("statusBarItem.hoverBackground"),
        );
        // А вот наложение на разные подложки даёт разное — это и рисует движок.
        expect(compositeOver(packRgba(255, 255, 255, 0x80), packRgb(0, 0, 0))).not.toBe(
            compositeOver(packRgba(255, 255, 255, 0x80), packRgb(255, 255, 255)),
        );
    });

    it("непрозрачное значение и короткие формы проходят как раньше", () => {
        const theme = themeWith({ "statusBarItem.hoverBackground": "#323233", "editor.background": "#123" });

        expect(theme.getRequiredColor("statusBarItem.hoverBackground")).toBe(packRgb(0x32, 0x32, 0x33));
        expect(theme.getRequiredColor("editor.background")).toBe(packRgb(0x11, 0x22, 0x33));
    });

    it("палитра var-scope несёт те же числа, включая альфу", () => {
        const theme = themeWith({ "editor.selectionBackground": "#9399b240" });
        const vars = computeThemeVars(theme);

        expect(vars["editor.selectionBackground"]).toBe(packRgba(0x93, 0x99, 0xb2, 0x40));
    });

    it("встроенные темы: Dark Modern везёт 12 цветов с альфой, Dark+ — два; ни один не отброшен", () => {
        const countTranslucent = (file: IThemeFile): number => {
            const palette = WorkbenchTheme.fromThemeFile(file).colors as Readonly<Record<string, number>>;
            // Только ключи самого файла: дефолты реестра тоже могут нести альфу.
            return Object.keys(file.colors).filter((key) => isTranslucent(palette[key])).length;
        };
        const alphaInFile = (file: IThemeFile): string[] =>
            Object.values(file.colors).filter((hex) => /^#[0-9a-f]{8}$/i.test(hex) && !/ff$/i.test(hex));
        // Полностью прозрачный (`#00000000`, button.secondaryBackground) — не
        // полупрозрачный, а сентинел TRANSPARENT_COLOR.
        const translucentInFile = (file: IThemeFile): number =>
            Object.values(file.colors).filter((hex) => isTranslucent(parseHexColor(hex))).length;

        expect(alphaInFile(darkModernTheme)).toHaveLength(12);
        expect(countTranslucent(darkModernTheme)).toBe(translucentInFile(darkModernTheme));
        expect(countTranslucent(darkPlusTheme)).toBe(translucentInFile(darkPlusTheme));
        expect(WorkbenchTheme.fromThemeFile(darkModernTheme).getColor("button.secondaryBackground")).toBe(
            TRANSPARENT_COLOR,
        );
    });
});
