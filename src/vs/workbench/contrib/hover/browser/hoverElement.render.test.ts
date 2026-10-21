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

describe("HoverElement — layout", () => {
    it("border + text: width follows the longest line, minimum 20", () => {
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

    it("new content at the same width replaces the cached lines", () => {
        const element = new HoverElement();
        element.setBlocks(["first"]);
        expect(element.linesFor(20)).toEqual(["first"]);

        element.setBlocks(["second"]);

        expect(element.linesFor(20)).toEqual(["second"]);
    });

    it("long text word-wraps within maxWidth", () => {
        const element = new HoverElement();
        element.maxWidth = 24;
        element.setBlocks(["long description for the symbol at the cursor"]);

        expectScreen(
            render(element),
            screen`
                ╭──────────────────────╮
                │ long description for │
                │ the symbol at the    │
                │ cursor               │
                ╰──────────────────────╯
            `,
        );
    });

    it("colors: border and background use hover widget tokens, text its own, separator the border color", () => {
        const element = new HoverElement();
        element.setBlocks(["first", "second"]);
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

    it("the popup doesn't take focus — like suggest, it lives while the editor is active", () => {
        expect(new HoverElement().focusable).toBe(false);
    });

    it("provider blocks are separated by a horizontal line", () => {
        const element = new HoverElement();
        element.setBlocks(["first", "second"]);

        expectScreen(
            render(element),
            screen`
                ╭──────────────────╮
                │ first            │
                │ ──────────────── │
                │ second           │
                ╰──────────────────╯
            `,
        );
    });

    it("height is clamped to maxHeight: extra lines are cut off", () => {
        const element = new HoverElement();
        element.maxHeight = 4;
        element.setBlocks(["one\ntwo\nthree\nfour\nfive"]);

        const width = element.getMinIntrinsicWidth(0);
        expect(element.getMinIntrinsicHeight(width)).toBe(4);
        expectScreen(
            render(element),
            screen`
                ╭──────────────────╮
                │ one              │
                │ two              │
                ╰──────────────────╯
            `,
        );
    });

    it("an empty element takes no space; empty blocks are dropped", () => {
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

        element.setBlocks(["text"]);
        expect(element.isEmpty).toBe(false);
    });
});
