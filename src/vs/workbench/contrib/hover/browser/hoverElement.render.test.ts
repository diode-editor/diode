import { Point } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it } from "vitest";

import { expectScreen, screen } from "../../../../../TestUtils/expectScreen.ts";
import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { computeThemeVars } from "../../../../platform/theme/browser/themeStyleVars.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";

import { HoverElement } from "./hoverElement.ts";

function render(element: HoverElement) {
    const width = element.getMinIntrinsicWidth(0);
    const height = element.getMinIntrinsicHeight(width);
    return renderElement(element, width, height, { themeVars: true });
}

describe("HoverElement — раскладка", () => {
    it("рамка + текст: ширина по самой длинной строке, минимум 20", () => {
        const element = new HoverElement();
        element.setBlocks(["const answer: number"]);

        // Max intrinsics equal min: the popup doesn't stretch (the overlay layer reads them).
        expect(element.getMaxIntrinsicWidth(0)).toBe(element.getMinIntrinsicWidth(0));
        expect(element.getMaxIntrinsicHeight(0)).toBe(element.getMinIntrinsicHeight(0));
        expectScreen(
            render(element),
            screen`
                ╭──────────────────────╮
                │ const answer: number │
                ╰──────────────────────╯
            `,
        );
    });

    it("длинный текст переносится по словам в maxWidth", () => {
        const element = new HoverElement();
        element.maxWidth = 24;
        element.setBlocks(["очень длинное описание символа под кареткой"]);

        expectScreen(
            render(element),
            screen`
                ╭──────────────────────╮
                │ очень длинное        │
                │ описание символа под │
                │ кареткой             │
                ╰──────────────────────╯
            `,
        );
    });

    it("цвета: рамка и фон — токены hover-виджета, текст — свой, разделитель — цветом рамки", () => {
        const element = new HoverElement();
        element.setBlocks(["первый", "второй"]);
        const backend = render(element);
        const vars = computeThemeVars(WorkbenchTheme.fromThemeFile(darkPlusTheme));

        expect(backend.getFgAt(new Point(0, 0))).toBe(vars["editorHoverWidget.border"]);
        expect(backend.getBgAt(new Point(2, 1))).toBe(vars["editorHoverWidget.background"]);
        // The fill covers the whole interior, including empty space past the text:
        // without it the editor would show through under the popup.
        const inner = backend.getBgAt(new Point(element.getMinIntrinsicWidth(0) - 2, 1));
        expect(inner).toBe(vars["editorHoverWidget.background"]);
        expect(backend.getFgAt(new Point(2, 1))).toBe(vars["editorHoverWidget.foreground"]);
        expect(backend.getFgAt(new Point(2, 2))).toBe(vars["editorHoverWidget.border"]);
    });

    it("попап не забирает фокус — как suggest, живёт при активном редакторе", () => {
        expect(new HoverElement().focusable).toBe(false);
    });

    it("блоки провайдеров разделяются горизонтальной линией", () => {
        const element = new HoverElement();
        element.setBlocks(["первый", "второй"]);

        expectScreen(
            render(element),
            screen`
                ╭──────────────────╮
                │ первый           │
                │ ──────────────── │
                │ второй           │
                ╰──────────────────╯
            `,
        );
    });

    it("высота клампится maxHeight: лишние строки обрезаются", () => {
        const element = new HoverElement();
        element.maxHeight = 4;
        element.setBlocks(["один\nдва\nтри\nчетыре\nпять"]);

        const width = element.getMinIntrinsicWidth(0);
        expect(element.getMinIntrinsicHeight(width)).toBe(4);
        expectScreen(
            render(element),
            screen`
                ╭──────────────────╮
                │ один             │
                │ два              │
                ╰──────────────────╯
            `,
        );
    });

    it("пустой элемент не занимает места; пустые блоки отбрасываются", () => {
        const element = new HoverElement();
        expect(element.isEmpty).toBe(true);
        expect(element.getMinIntrinsicWidth(0)).toBe(0);
        expect(element.getMaxIntrinsicWidth(0)).toBe(0);
        expect(element.getMinIntrinsicHeight(0)).toBe(0);
        expect(element.getMaxIntrinsicHeight(0)).toBe(0);
        // Even in a frame where the border would fit, an empty popup draws nothing.
        expectScreen(renderElement(element, 3, 3, { themeVars: true }), "");

        element.setBlocks(["   ", ""]);
        expect(element.isEmpty).toBe(true);

        element.setBlocks(["текст"]);
        expect(element.isEmpty).toBe(false);
    });
});
