import { describe, expect, it } from "vitest";

import { renderElement } from "../../../src/TestUtils/renderElement.ts";
import { BoxConstraints, Offset, Point, Size } from "../../common/geometryPromitives.ts";
import { TUIElement } from "../../dom/tuiElement.ts";

import { BoxContainerElement } from "./boxContainerElement.ts";

/** Child with known intrinsic sizes for verifying the box's padding math. */
class IntrinsicStub extends TUIElement {
    public override getMinIntrinsicWidth(_height: number): number {
        return 10;
    }
    public override getMaxIntrinsicWidth(_height: number): number {
        return 14;
    }
    public override getMinIntrinsicHeight(_width: number): number {
        return 3;
    }
    public override getMaxIntrinsicHeight(_width: number): number {
        return 5;
    }
}

describe("BoxContainerElement", () => {
    describe("render — borders", () => {
        it("draws box-drawing border corners and edges", () => {
            const box = new BoxContainerElement();
            const backend = renderElement(box, 6, 3);

            expect(backend.getTextAt(new Point(0, 0), 6)).toBe("╭────╮");
            expect(backend.getTextAt(new Point(0, 1), 6)).toBe("│    │");
            expect(backend.getTextAt(new Point(0, 2), 6)).toBe("╰────╯");
        });
    });

    describe("render — title", () => {
        it("draws a centered title on the second row", () => {
            const box = new BoxContainerElement();
            box.setTitle("Hi");
            const backend = renderElement(box, 8, 5);

            // Title "Hi" centered in width 8 → floor((8-2)/2) = 3
            expect(backend.getTextAt(new Point(3, 1), 2)).toBe("Hi");
        });

        it("draws a separator row when hasSeparator is enabled with a title", () => {
            const box = new BoxContainerElement();
            box.setTitle("T");
            box.setHasSeparator(true);
            const backend = renderElement(box, 6, 6);

            // Separator row at y=2 uses ├ ─ ┤
            expect(backend.getTextAt(new Point(0, 2), 6)).toBe("├────┤");
        });

        it("draws no separator row when hasSeparator is false", () => {
            const box = new BoxContainerElement();
            box.setTitle("T");
            box.setHasSeparator(false);
            const backend = renderElement(box, 6, 6);

            // y=2 should be a plain interior row, not a separator
            expect(backend.getTextAt(new Point(0, 2), 6)).toBe("│    │");
        });

        it("renders no title row when title is undefined", () => {
            const box = new BoxContainerElement();
            const backend = renderElement(box, 8, 5);

            // Interior row 1 is blank between the side borders
            expect(backend.getTextAt(new Point(1, 1), 6)).toBe("      ");
        });
    });

    describe("intrinsic width", () => {
        it("returns 2 (border) when there is no child", () => {
            const box = new BoxContainerElement();
            expect(box.getMinIntrinsicWidth(10)).toBe(2);
            expect(box.getMaxIntrinsicWidth(10)).toBe(2);
        });

        it("adds 2 for borders around the child width", () => {
            const box = new BoxContainerElement();
            box.setChild(new IntrinsicStub());
            expect(box.getMinIntrinsicWidth(10)).toBe(12); // 10 + 2
            expect(box.getMaxIntrinsicWidth(10)).toBe(16); // 14 + 2
        });
    });

    describe("intrinsic height", () => {
        it("returns just vertical border padding when there is no child", () => {
            const box = new BoxContainerElement();
            expect(box.getMinIntrinsicHeight(10)).toBe(2); // 2 borders, no header
            expect(box.getMaxIntrinsicHeight(10)).toBe(2);
        });

        it("adds one header row when a title is present", () => {
            const box = new BoxContainerElement();
            box.setTitle("X");
            expect(box.getMinIntrinsicHeight(10)).toBe(3); // 2 borders + 1 header
        });

        it("adds two header rows when title plus separator", () => {
            const box = new BoxContainerElement();
            box.setTitle("X");
            box.setHasSeparator(true);
            expect(box.getMinIntrinsicHeight(10)).toBe(4); // 2 borders + 2 header
        });

        it("includes the child height with a single header row (title, no separator)", () => {
            const box = new BoxContainerElement();
            box.setChild(new IntrinsicStub());
            box.setTitle("X"); // headerRows = 1 (no separator)
            // child min height 3 + (2 border + 1 header) = 6
            expect(box.getMinIntrinsicHeight(10)).toBe(6);
            // child max height 5 + 3 = 8
            expect(box.getMaxIntrinsicHeight(10)).toBe(8);
        });

        it("clamps the child width to zero when narrower than the border", () => {
            const box = new BoxContainerElement();
            box.setChild(new IntrinsicStub());
            // width 1 < border 2 → child receives Math.max(0, 1 - 2) = 0
            // intrinsic stub ignores width, so result is child height + border padding (2)
            expect(box.getMinIntrinsicHeight(1)).toBe(5); // 3 + 2
            expect(box.getMaxIntrinsicHeight(1)).toBe(7); // 5 + 2
        });

        it("includes the child height plus border and header padding", () => {
            const box = new BoxContainerElement();
            box.setChild(new IntrinsicStub());
            box.setTitle("X");
            box.setHasSeparator(true);
            // child min height 3 + (2 border + 2 header) = 7
            expect(box.getMinIntrinsicHeight(10)).toBe(7);
            // child max height 5 + 4 = 9
            expect(box.getMaxIntrinsicHeight(10)).toBe(9);
        });
    });

    describe("child layout", () => {
        it("positions the child inside the border, below the header", () => {
            const box = new BoxContainerElement();
            const child = new TUIElement();
            box.setChild(child);
            box.setTitle("T");
            box.setHasSeparator(true);

            box.localPosition = new Offset(0, 0);
            box.performLayout(BoxConstraints.tight(new Size(10, 8)));

            // paddingX = 1, paddingTop = 1 + headerRows(2) = 3
            expect(child.globalPosition).toEqual(new Point(1, 3));
            // childWidth = 10 - 2 = 8, childHeight = 8 - 3 - 1 = 4
            expect(child.layoutSize).toEqual(new Size(8, 4));
        });
    });
});
