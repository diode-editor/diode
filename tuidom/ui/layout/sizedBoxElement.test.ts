import { describe, expect, it } from "vitest";

import { renderElement } from "../../../src/TestUtils/renderElement.ts";
import { BoxConstraints, Size } from "../../common/geometryPromitives.ts";
import { TUIElement } from "../../dom/tuiElement.ts";

import { SizedBox, SizedBoxElement } from "./sizedBoxElement.ts";

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

    it("replacing the child detaches the previous one", () => {
        const box = new SizedBoxElement(10, 1);
        const first = new FixedIntrinsicChild(4, 1);
        box.setChild(first);
        expect(box.getChildren()).toEqual([first]);
        box.setChild(null);
        expect(first.getParent()).toBeNull();
        expect(box.getChildren()).toEqual([]);
    });

    it("JSX adapter builds and updates preferred size + child", () => {
        const first = new FixedIntrinsicChild(10, 1);
        const el = SizedBox({ width: 40, height: 3, children: first });
        expect(el).toBeInstanceOf(SizedBoxElement);
        expect(el.getChild()).toBe(first);
        expect(el.getMaxIntrinsicWidth(0)).toBe(40);

        const second = new FixedIntrinsicChild(10, 1);
        SizedBox.update(el, { width: 50, height: 3, children: second });
        expect(el.getMaxIntrinsicWidth(0)).toBe(50);
        expect(el.getChild()).toBe(second);

        // Update with no children clears the child.
        SizedBox.update(el, { width: 50, height: 3 });
        expect(el.getChild()).toBeNull();
    });

    it("JSX adapter builds a childless box when no children are passed", () => {
        const el = SizedBox({ width: 30, height: 2 });
        expect(el).toBeInstanceOf(SizedBoxElement);
        expect(el.getChild()).toBeNull();
        expect(el.getMaxIntrinsicWidth(0)).toBe(30);

        // An explicit empty children array also yields no child.
        const empty = SizedBox({ width: 30, height: 2, children: [] });
        expect(empty.getChild()).toBeNull();
    });
});
