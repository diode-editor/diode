import { describe, expect, it } from "vitest";

import { renderElement } from "../../testing/renderElement.ts";
import { Point } from "../../common/geometryPromitives.ts";

import { TextBlockElement } from "./textBlockElement.ts";

describe("TextBlockElement", () => {
    it("generates numbered lines and exposes content size", () => {
        const block = new TextBlockElement(3);
        expect(block.contentHeight).toBe(3);
        // "Line 001" → 8 columns wide.
        expect(block.contentWidth).toBe(8);
        expect(block.getMinIntrinsicWidth(1)).toBe(8);
        expect(block.getMaxIntrinsicWidth(1)).toBe(8);
        expect(block.getMinIntrinsicHeight(1)).toBe(3);
        expect(block.getMaxIntrinsicHeight(1)).toBe(3);
    });

    it("renders each generated line on its own row", () => {
        const block = new TextBlockElement(2);
        const backend = renderElement(block, 8, 2);
        expect(backend.getTextAt(new Point(0, 0), 8)).toBe("Line 001");
        expect(backend.getTextAt(new Point(0, 1), 8)).toBe("Line 002");
    });

    it("renders blank rows past the generated lines when contentHeight exceeds line count", () => {
        const block = new TextBlockElement(1);
        // Force more rows than there are generated lines, exercising the empty-line branch.
        block.contentHeight = 3;
        const backend = renderElement(block, 8, 3);

        expect(backend.getTextAt(new Point(0, 0), 8)).toBe("Line 001");
        // Rows 1 and 2 have no backing line → rendered as blanks.
        expect(backend.getTextAt(new Point(0, 1), 8).trim()).toBe("");
        expect(backend.getTextAt(new Point(0, 2), 8).trim()).toBe("");
    });
});
