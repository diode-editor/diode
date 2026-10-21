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

/** Compositing is covered by tuidom tests (`grid.alpha.test.ts`) and editor frame tests; here, that the theme loses nothing on the way. */
describe("WorkbenchTheme: colors with alpha go to the palette as is", () => {
    it("a translucent theme value stays a translucent number", () => {
        const theme = themeWith({ "statusBarItem.hoverBackground": "#F1F1F133" });
        const hover = theme.getRequiredColor("statusBarItem.hoverBackground");

        expect(hover).toBe(packRgba(0xf1, 0xf1, 0xf1, 0x33));
        expect(isTranslucent(hover)).toBe(true);
        expect(unpackA(hover)).toBe(0x33);
    });

    it("the backdrop takes no part in parsing; the engine blends at paint time", () => {
        const overDark = themeWith({ "statusBar.background": "#000000", "statusBarItem.hoverBackground": "#FFFFFF80" });
        const overLight = themeWith({
            "statusBar.background": "#FFFFFF",
            "statusBarItem.hoverBackground": "#FFFFFF80",
        });

        expect(overDark.getRequiredColor("statusBarItem.hoverBackground")).toBe(
            overLight.getRequiredColor("statusBarItem.hoverBackground"),
        );
        // Compositing over different backdrops does differ, and that is what the engine paints.
        expect(compositeOver(packRgba(255, 255, 255, 0x80), packRgb(0, 0, 0))).not.toBe(
            compositeOver(packRgba(255, 255, 255, 0x80), packRgb(255, 255, 255)),
        );
    });

    it("opaque values and short forms pass as before", () => {
        const theme = themeWith({ "statusBarItem.hoverBackground": "#323233", "editor.background": "#123" });

        expect(theme.getRequiredColor("statusBarItem.hoverBackground")).toBe(packRgb(0x32, 0x32, 0x33));
        expect(theme.getRequiredColor("editor.background")).toBe(packRgb(0x11, 0x22, 0x33));
    });

    it("the var-scope palette carries the same numbers, alpha included", () => {
        const theme = themeWith({ "editor.selectionBackground": "#9399b240" });
        const vars = computeThemeVars(theme);

        expect(vars["editor.selectionBackground"]).toBe(packRgba(0x93, 0x99, 0xb2, 0x40));
    });

    it("built-in themes: Dark Modern has 12 colors with alpha, Dark+ has two; none are dropped", () => {
        const countTranslucent = (file: IThemeFile): number => {
            const palette = WorkbenchTheme.fromThemeFile(file).colors as Readonly<Record<string, number>>;
            // Only the file's own keys: registry defaults may carry alpha too.
            return Object.keys(file.colors).filter((key) => isTranslucent(palette[key])).length;
        };
        const alphaInFile = (file: IThemeFile): string[] =>
            Object.values(file.colors).filter((hex) => /^#[0-9a-f]{8}$/i.test(hex) && !/ff$/i.test(hex));
        // Fully transparent (`#00000000`, button.secondaryBackground) is not translucent but the
        // TRANSPARENT_COLOR sentinel.
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
