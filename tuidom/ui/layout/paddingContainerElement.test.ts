import { describe, expect, it } from "vitest";

import { expectScreen, screen } from "../../../src/TestUtils/expectScreen.ts";
import { MockTerminalBackend } from "../../backend/mockTerminalBackend.ts";
import { DEFAULT_COLOR, packRgb } from "../../common/colorUtils.ts";
import { BoxConstraints, Offset, Point, Size } from "../../common/geometryPromitives.ts";
import { ROOT_RESOLVED_STYLE } from "../../dom/styles/tuiStyle.ts";
import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";
import { TerminalScreen } from "../../rendering/terminalScreen.ts";

import { BoxElement } from "./boxElement.ts";
import { PaddingContainerElement } from "./paddingContainerElement.ts";

/** Child with distinct, known intrinsic sizes so we can verify padding math. */
class IntrinsicStub extends TUIElement {
    public override getMinIntrinsicWidth(_height: number): number {
        return 10;
    }
    public override getMaxIntrinsicWidth(_height: number): number {
        return 20;
    }
    public override getMinIntrinsicHeight(_width: number): number {
        return 4;
    }
    public override getMaxIntrinsicHeight(_width: number): number {
        return 8;
    }
}

function layoutAndRender(element: PaddingContainerElement, width: number, height: number): MockTerminalBackend {
    const size = new Size(width, height);
    const backend = new MockTerminalBackend(size);
    const termScreen = new TerminalScreen(size);

    element.localPosition = new Offset(0, 0);
    element.performLayout(BoxConstraints.tight(size));
    element.render(new RenderContext(termScreen));
    termScreen.flush(backend);
    return backend;
}

describe("PaddingContainerElement", () => {
    it("computes child size with top and left padding", () => {
        const box = new BoxElement();
        const padded = new PaddingContainerElement(box, { top: 1, left: 1 });

        padded.localPosition = new Offset(0, 0);
        padded.performLayout(BoxConstraints.tight(new Size(8, 5)));

        expect(box.layoutSize.width).toBe(7); // 8 - 1 left
        expect(box.layoutSize.height).toBe(4); // 5 - 1 top
    });

    it("computes child size with all paddings", () => {
        const box = new BoxElement();
        const padded = new PaddingContainerElement(box, { top: 2, left: 3, right: 1, bottom: 1 });

        padded.localPosition = new Offset(0, 0);
        padded.performLayout(BoxConstraints.tight(new Size(20, 10)));

        expect(box.layoutSize.width).toBe(16); // 20 - 3 - 1
        expect(box.layoutSize.height).toBe(7); // 10 - 2 - 1
    });

    it("sets child globalPosition with padding offset", () => {
        const box = new BoxElement();
        const padded = new PaddingContainerElement(box, { top: 2, left: 3 });

        padded.localPosition = new Offset(5, 10);
        padded.performLayout(BoxConstraints.tight(new Size(20, 10)));

        expect(box.globalPosition.x).toBe(8); // 5 + 3
        expect(box.globalPosition.y).toBe(12); // 10 + 2
    });

    it("renders child without padding (defaults to 0)", () => {
        const box = new BoxElement();
        const padded = new PaddingContainerElement(box);

        const backend = layoutAndRender(padded, 6, 4);

        expectScreen(
            backend,
            screen`
                +----+
                |    |
                |    |
                +----+
            `,
        );
    });

    it("renders child shifted by padding", () => {
        const box = new BoxElement();
        const padded = new PaddingContainerElement(box, { top: 1, left: 1 });

        const backend = layoutAndRender(padded, 8, 5);

        // Row 0: empty (top padding) — nothing drawn
        // Rows 1-4: box shifted right by 1 (left padding)
        expect(backend.getTextAt(new Point(1, 1), 7)).toBe("+-----+");
        expect(backend.getTextAt(new Point(1, 2), 7)).toBe("|     |");
        expect(backend.getTextAt(new Point(1, 3), 7)).toBe("|     |");
        expect(backend.getTextAt(new Point(1, 4), 7)).toBe("+-----+");
    });

    it("clamps child size to zero when padding exceeds container", () => {
        const box = new BoxElement();
        const padded = new PaddingContainerElement(box, { top: 10, left: 10 });

        padded.localPosition = new Offset(0, 0);
        padded.performLayout(BoxConstraints.tight(new Size(5, 5)));

        expect(box.layoutSize.width).toBe(0);
        expect(box.layoutSize.height).toBe(0);
    });

    it("offsets and sizes the child using all four asymmetric paddings", () => {
        const child = new TUIElement();
        // Distinct padding per side so each of top/right/bottom/left is exercised.
        const padded = new PaddingContainerElement(child, { top: 2, right: 4, bottom: 1, left: 3 });

        padded.localPosition = new Offset(7, 9);
        padded.performLayout(BoxConstraints.tight(new Size(20, 10)));

        // child is offset by (left, top) from the container's global position
        expect(child.localPosition).toEqual(new Offset(3, 2));
        expect(child.globalPosition).toEqual(new Point(10, 11)); // (7+3, 9+2)
        // child sized to (width - left - right, height - top - bottom)
        expect(child.layoutSize).toEqual(new Size(13, 7)); // (20-3-4, 10-2-1)
    });

    describe("intrinsic sizes", () => {
        it("adds horizontal padding to child's min/max intrinsic width", () => {
            const child = new IntrinsicStub();
            const padded = new PaddingContainerElement(child, { left: 3, right: 2, top: 1, bottom: 1 });

            // child min width 10 + left 3 + right 2
            expect(padded.getMinIntrinsicWidth(20)).toBe(15);
            // child max width 20 + left 3 + right 2
            expect(padded.getMaxIntrinsicWidth(20)).toBe(25);
        });

        it("adds vertical padding to child's min/max intrinsic height", () => {
            const child = new IntrinsicStub();
            const padded = new PaddingContainerElement(child, { left: 3, right: 2, top: 2, bottom: 1 });

            // child min height 4 + top 2 + bottom 1
            expect(padded.getMinIntrinsicHeight(40)).toBe(7);
            // child max height 8 + top 2 + bottom 1
            expect(padded.getMaxIntrinsicHeight(40)).toBe(11);
        });

        it("returns only horizontal padding for width when child is null", () => {
            const padded = new PaddingContainerElement(null, { left: 4, right: 3, top: 5, bottom: 6 });

            expect(padded.getMinIntrinsicWidth(10)).toBe(7); // 4 + 3
            expect(padded.getMaxIntrinsicWidth(10)).toBe(7);
        });

        it("returns only vertical padding for height when child is null", () => {
            const padded = new PaddingContainerElement(null, { left: 4, right: 3, top: 5, bottom: 6 });

            expect(padded.getMinIntrinsicHeight(10)).toBe(11); // 5 + 6
            expect(padded.getMaxIntrinsicHeight(10)).toBe(11);
        });

        it("returns zero intrinsic sizes for null child with no padding", () => {
            const padded = new PaddingContainerElement(null);

            expect(padded.getMinIntrinsicWidth(10)).toBe(0);
            expect(padded.getMaxIntrinsicWidth(10)).toBe(0);
            expect(padded.getMinIntrinsicHeight(10)).toBe(0);
            expect(padded.getMaxIntrinsicHeight(10)).toBe(0);
        });
    });

    describe("padding getters and setters", () => {
        it("exposes initial padding via getters", () => {
            const padded = new PaddingContainerElement(null, { top: 1, right: 2, bottom: 3, left: 4 });

            expect(padded.getPaddingTop()).toBe(1);
            expect(padded.getPaddingRight()).toBe(2);
            expect(padded.getPaddingBottom()).toBe(3);
            expect(padded.getPaddingLeft()).toBe(4);
        });

        it("reflects updates made through setters", () => {
            const padded = new PaddingContainerElement(null);

            padded.setPaddingTop(5);
            padded.setPaddingRight(6);
            padded.setPaddingBottom(7);
            padded.setPaddingLeft(8);

            expect(padded.getPaddingTop()).toBe(5);
            expect(padded.getPaddingRight()).toBe(6);
            expect(padded.getPaddingBottom()).toBe(7);
            expect(padded.getPaddingLeft()).toBe(8);
        });

        it("setting padding changes intrinsic width", () => {
            const child = new IntrinsicStub();
            const padded = new PaddingContainerElement(child);

            expect(padded.getMaxIntrinsicWidth(10)).toBe(20); // no padding yet
            padded.setPaddingLeft(5);
            padded.setPaddingRight(5);
            expect(padded.getMaxIntrinsicWidth(10)).toBe(30);
        });
    });

    it("renders padding cells with explicit bg color, not transparent", () => {
        const BG = packRgb(37, 37, 38);
        const padded = new PaddingContainerElement(null, { top: 1, bottom: 1, left: 2, right: 2 });
        padded.style = { bg: BG };

        const size = new Size(8, 4);
        const backend = new MockTerminalBackend(size);
        const termScreen = new TerminalScreen(size);

        padded.localPosition = new Offset(0, 0);
        padded.performStyleResolution(ROOT_RESOLVED_STYLE);
        padded.performLayout(BoxConstraints.tight(size));
        padded.render(new RenderContext(termScreen));
        termScreen.flush(backend);

        // Top padding row
        expect(backend.getBgAt(new Point(0, 0))).toBe(BG);
        expect(backend.getBgAt(new Point(0, 0))).not.toBe(DEFAULT_COLOR);
        // Bottom padding row
        expect(backend.getBgAt(new Point(0, 3))).toBe(BG);
        // Left padding column (middle rows)
        expect(backend.getBgAt(new Point(0, 1))).toBe(BG);
        expect(backend.getBgAt(new Point(1, 1))).toBe(BG);
        // Right padding column (middle rows)
        expect(backend.getBgAt(new Point(6, 1))).toBe(BG);
        expect(backend.getBgAt(new Point(7, 1))).toBe(BG);
    });

    describe("setChild", () => {
        it("detaches the previous child when a new one replaces it", () => {
            const first = new TUIElement();
            const padded = new PaddingContainerElement(first);
            expect(first.getParent()).toBe(padded);

            const second = new TUIElement();
            padded.setChild(second);

            // The old child is detached and the new one adopted.
            expect(first.getParent()).toBeNull();
            expect(second.getParent()).toBe(padded);
            expect(padded.getChildren()).toEqual([second]);
        });

        it("adopts the first child when none was set initially", () => {
            // Starts with no child, so setChild takes the no-detach path.
            const padded = new PaddingContainerElement(null);
            expect(padded.getChildren()).toEqual([]);

            const child = new TUIElement();
            padded.setChild(child);

            expect(child.getParent()).toBe(padded);
            expect(padded.getChildren()).toEqual([child]);
        });

        it("clears the child to null, detaching it", () => {
            const child = new TUIElement();
            const padded = new PaddingContainerElement(child);

            padded.setChild(null);

            expect(child.getParent()).toBeNull();
            expect(padded.getChildren()).toEqual([]);
        });
    });
});
