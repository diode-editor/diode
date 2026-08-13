import { describe, expect, it } from "vitest";

import { renderElement } from "../../testing/renderElement.ts";
import { BoxConstraints, Size } from "../../common/geometryPromitives.ts";
import { TUIElement } from "../../dom/tuiElement.ts";

import { SizedBoxElement } from "./sizedBoxElement.ts";

/** Ребёнок с известным max-intrinsic и базовым (tight-послушным) performLayout. */
class FixedIntrinsicChild extends TUIElement {
    public constructor(
        private readonly w: number,
        private readonly h: number,
    ) {
        super();
    }
    public override getMinIntrinsicWidth(): number {
        return this.w;
    }
    public override getMaxIntrinsicWidth(): number {
        return this.w;
    }
    public override getMinIntrinsicHeight(): number {
        return this.h;
    }
    public override getMaxIntrinsicHeight(): number {
        return this.h;
    }
}

describe("SizedBoxElement", () => {
    it("takes the preferred size under loose constraints", () => {
        const box = new SizedBoxElement(44, 3);
        box.setChild(new FixedIntrinsicChild(10, 1));
        const size = box.layout(BoxConstraints.loose(new Size(80, 24)));
        expect(size).toEqual(new Size(44, 3));
    });

    it("clamps the preferred size down to the constraint maximum", () => {
        const box = new SizedBoxElement(44, 3);
        box.setChild(new FixedIntrinsicChild(10, 1));
        const size = box.layout(BoxConstraints.loose(new Size(20, 3)));
        expect(size).toEqual(new Size(20, 3));
    });

    it("lays the child out tight at the resolved size", () => {
        const box = new SizedBoxElement(44, 3);
        const child = new FixedIntrinsicChild(10, 1);
        box.setChild(child);
        box.layout(BoxConstraints.loose(new Size(80, 24)));
        expect(child.layoutSize).toEqual(new Size(44, 3));
    });

    it("delegates an unset axis to the child's intrinsic size (min and max)", () => {
        const box = new SizedBoxElement(undefined, undefined);
        box.setChild(new FixedIntrinsicChild(12, 5));
        expect(box.getMinIntrinsicWidth(0)).toBe(12);
        expect(box.getMaxIntrinsicWidth(0)).toBe(12);
        expect(box.getMinIntrinsicHeight(0)).toBe(5);
        expect(box.getMaxIntrinsicHeight(0)).toBe(5);
        const size = box.layout(BoxConstraints.loose(new Size(80, 24)));
        expect(size).toEqual(new Size(12, 5));
    });

    it("reports the preferred size as its intrinsic size (min and max)", () => {
        const box = new SizedBoxElement(44, 3);
        box.setChild(new FixedIntrinsicChild(10, 1));
        expect(box.getMinIntrinsicWidth(0)).toBe(44);
        expect(box.getMaxIntrinsicWidth(0)).toBe(44);
        expect(box.getMinIntrinsicHeight(0)).toBe(3);
        expect(box.getMaxIntrinsicHeight(0)).toBe(3);
    });

    it("an empty box (no preferred size, no child) reports zero and renders nothing", () => {
        const box = new SizedBoxElement();
        expect(box.getMinIntrinsicWidth(0)).toBe(0);
        expect(box.getMaxIntrinsicWidth(0)).toBe(0);
        expect(box.getMinIntrinsicHeight(0)).toBe(0);
        expect(box.getMaxIntrinsicHeight(0)).toBe(0);
        expect(box.getChild()).toBeNull();
        expect(box.getChildren()).toEqual([]);
        // Renders without a child — the `if (this.child)` branch stays false, no throw.
        expect(() => renderElement(box, 4, 2)).not.toThrow();
    });

    it("setters update the preferred size", () => {
        const box = new SizedBoxElement(10, 2);
        box.setPreferredWidth(30);
        box.setPreferredHeight(5);
        expect(box.getMaxIntrinsicWidth(0)).toBe(30);
        expect(box.getMaxIntrinsicHeight(0)).toBe(5);
    });

    it("replacing the child detaches the previous one", () => {
        const box = new SizedBoxElement(10, 1);
        const first = new FixedIntrinsicChild(4, 1);
        box.setChild(first);
        expect(box.getChildren()).toEqual([first]);
        box.setChild(null);
        expect(first.getParent()).toBeNull();
        expect(box.getChildren()).toEqual([]);
    });
});
