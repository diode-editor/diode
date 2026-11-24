import { Point } from "@tuidom/core/common/geometryPromitives";
import { TAB_HEIGHT } from "@tuidom/elements/editorgroup/editorTabItemElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import { describe, expect, it } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";

import { EditorTitleActionsBox } from "./editorTitleActionsBox.ts";

const theme = WorkbenchTheme.fromThemeFile(darkPlusTheme);

function rows(backend: ReturnType<typeof renderElement>, width: number, height: number): string[] {
    return Array.from({ length: height }, (_, y) => backend.getTextAt(new Point(0, y), width));
}

describe("EditorTitleActionsBox", () => {
    it("is as tall as a tab (3 rows) and as wide as its buttons", () => {
        const actions = new TextLabelElement("[a][b]");
        const box = new EditorTitleActionsBox(actions);

        expect(TAB_HEIGHT).toBe(3);
        expect(box.getMinIntrinsicHeight()).toBe(TAB_HEIGHT);
        expect(box.getMaxIntrinsicHeight()).toBe(TAB_HEIGHT);
        expect(box.getMinIntrinsicWidth(TAB_HEIGHT)).toBe(6);
        expect(box.getMaxIntrinsicWidth(TAB_HEIGHT)).toBe(6);
    });

    it("puts the buttons on the tabs' label row (row 1) and the baseline ending in ╮ on row 2", () => {
        const actions = new TextLabelElement("[a][b]");
        const box = new EditorTitleActionsBox(actions);

        const backend = renderElement(box, 6, 3, { themeVars: true });

        expect(rows(backend, 6, 3)).toEqual(["      ", "[a][b]", "─────╮"]);
        expect(actions.globalPosition.y).toBe(1);
        expect(actions.layoutSize.height).toBe(1);
        expect(actions.layoutSize.width).toBe(6);
    });

    it("paints the workbench surface above the buttons and the tabs' baseline colors under them", () => {
        const box = new EditorTitleActionsBox(new TextLabelElement("[a]"));

        const backend = renderElement(box, 3, 3, { themeVars: true });

        for (let x = 0; x < 3; x++) {
            expect(backend.getBgAt(new Point(x, 0)), `surface, column ${x}`).toBe(
                theme.getRequiredColor("editorGroupHeader.tabsBackground"),
            );
            expect(backend.getFgAt(new Point(x, 2)), `baseline, column ${x}`).toBe(
                theme.getRequiredColor("tab.border"),
            );
            expect(backend.getBgAt(new Point(x, 2)), `baseline, column ${x}`).toBe(
                theme.getRequiredColor("tab.activeBackground"),
            );
        }
    });

    it("draws no baseline when squeezed below a tab's height", () => {
        const box = new EditorTitleActionsBox(new TextLabelElement("[a]"));

        const backend = renderElement(box, 3, 2, { themeVars: true });

        expect(rows(backend, 3, 2)).toEqual(["   ", "[a]"]);
    });
});
