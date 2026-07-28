import { describe, expect, it } from "vitest";

import { BoxConstraints, Offset, Point, Size } from "../../common/geometryPromitives.ts";
import { TUIElement } from "../../dom/tuiElement.ts";

import { VFlexElement, vflexFill, vflexFit, vflexFixed } from "./vFlexElement.ts";

class FixedSizeElement extends TUIElement {
    private intrinsicWidth: number;
    private intrinsicHeight: number;

    public constructor(width: number, height: number) {
        super();
        this.intrinsicWidth = width;
        this.intrinsicHeight = height;
    }

    public override getMinIntrinsicWidth(_height: number): number {
        return this.intrinsicWidth;
    }

    public override getMaxIntrinsicWidth(_height: number): number {
        return this.intrinsicWidth;
    }

    public override getMinIntrinsicHeight(_width: number): number {
        return this.intrinsicHeight;
    }

    public override getMaxIntrinsicHeight(_width: number): number {
        return this.intrinsicHeight;
    }
}

function layoutVFlex(flex: VFlexElement, width = 80, height = 24): void {
    flex.localPosition = new Offset(0, 0);
    flex.layout(BoxConstraints.tight(new Size(width, height)));
}

describe("VFlexElement", () => {
    describe("all fixed children", () => {
        it("lays out children top to bottom with fixed heights", () => {
            const flex = new VFlexElement();
            const a = new TUIElement();
            const b = new TUIElement();
            const c = new TUIElement();

            flex.addChild(a, { height: vflexFixed(5), width: 10 });
            flex.addChild(b, { height: vflexFixed(8), width: 10 });
            flex.addChild(c, { height: vflexFixed(4), width: 10 });

            layoutVFlex(flex, 80, 24);

            expect(a.layoutSize).toEqual(new Size(10, 5));
            expect(b.layoutSize).toEqual(new Size(10, 8));
            expect(c.layoutSize).toEqual(new Size(10, 4));

            expect(a.localPosition.dy).toBe(0);
            expect(b.localPosition.dy).toBe(5);
            expect(c.localPosition.dy).toBe(13);
        });
    });

    describe("fixed + fit", () => {
        it("fit child gets its intrinsic height", () => {
            const flex = new VFlexElement();
            const fixed = new TUIElement();
            const fit = new FixedSizeElement(10, 6);

            flex.addChild(fixed, { height: vflexFixed(5), width: 10 });
            flex.addChild(fit, { height: vflexFit(), width: 10 });

            layoutVFlex(flex, 80, 24);

            expect(fixed.layoutSize.height).toBe(5);
            expect(fit.layoutSize.height).toBe(6);
            expect(fit.localPosition.dy).toBe(5);
        });
    });

    describe("fixed + fill", () => {
        it("fill child takes remaining height", () => {
            const flex = new VFlexElement();
            const fixed = new TUIElement();
            const fill = new TUIElement();

            flex.addChild(fixed, { height: vflexFixed(4), width: 10 });
            flex.addChild(fill, { height: vflexFill(), width: 10 });

            layoutVFlex(flex, 80, 24);

            expect(fixed.layoutSize.height).toBe(4);
            expect(fill.layoutSize.height).toBe(20);
            expect(fill.localPosition.dy).toBe(4);
        });
    });

    describe("fixed + fit + fill", () => {
        it("allocates fixed, then fit, then remaining to fill", () => {
            const flex = new VFlexElement();
            const fixed = new TUIElement();
            const fit = new FixedSizeElement(10, 6);
            const fill = new TUIElement();

            flex.addChild(fixed, { height: vflexFixed(4), width: 10 });
            flex.addChild(fit, { height: vflexFit(), width: 10 });
            flex.addChild(fill, { height: vflexFill(), width: 10 });

            layoutVFlex(flex, 80, 24);

            expect(fixed.layoutSize.height).toBe(4);
            expect(fit.layoutSize.height).toBe(6);
            expect(fill.layoutSize.height).toBe(14);

            expect(fixed.localPosition.dy).toBe(0);
            expect(fit.localPosition.dy).toBe(4);
            expect(fill.localPosition.dy).toBe(10);
        });
    });

    describe("fill gets zero when no space left", () => {
        it("fill child gets 0 height when fixed children consume all space", () => {
            const flex = new VFlexElement();
            const fixed = new TUIElement();
            const fill = new TUIElement();

            flex.addChild(fixed, { height: vflexFixed(24), width: 10 });
            flex.addChild(fill, { height: vflexFill(), width: 10 });

            layoutVFlex(flex, 80, 24);

            expect(fill.layoutSize.height).toBe(0);
        });
    });

    describe("cross axis: width fill", () => {
        it("fill width child takes container width", () => {
            const flex = new VFlexElement();
            const child = new TUIElement();

            flex.addChild(child, { height: vflexFixed(5), width: "fill" });

            layoutVFlex(flex, 80, 24);

            expect(child.layoutSize.width).toBe(80);
        });

        it("fixed width child keeps its width", () => {
            const flex = new VFlexElement();
            const child = new TUIElement();

            flex.addChild(child, { height: vflexFixed(5), width: 7 });

            layoutVFlex(flex, 80, 24);

            expect(child.layoutSize.width).toBe(7);
        });
    });

    describe("error on second fill", () => {
        it("throws when adding a second fill child", () => {
            const flex = new VFlexElement();
            flex.addChild(new TUIElement(), { height: vflexFill(), width: 10 });

            expect(() => {
                flex.addChild(new TUIElement(), { height: vflexFill(), width: 10 });
            }).toThrow("VFlexElement supports at most one fill child");
        });
    });

    describe("global positions", () => {
        it("sets correct global positions for children", () => {
            const flex = new VFlexElement();
            flex.localPosition = new Offset(5, 10);

            const a = new TUIElement();
            const b = new TUIElement();
            flex.addChild(a, { height: vflexFixed(4), width: 20 });
            flex.addChild(b, { height: vflexFixed(6), width: 20 });

            flex.layout(BoxConstraints.tight(new Size(80, 24)));

            expect(a.globalPosition).toEqual(new Point(5, 10));
            expect(b.globalPosition).toEqual(new Point(5, 14));
        });
    });

    describe("intrinsic size of VFlexElement itself", () => {
        it("max intrinsic height is sum of children heights", () => {
            const flex = new VFlexElement();
            flex.addChild(new FixedSizeElement(10, 3), { height: vflexFixed(3), width: 10 });
            flex.addChild(new FixedSizeElement(10, 6), { height: vflexFit(), width: 10 });
            flex.addChild(new FixedSizeElement(10, 8), { height: vflexFill(), width: 10 });

            expect(flex.getMaxIntrinsicHeight(100)).toBe(3 + 6 + 8);
        });

        it("min intrinsic height is sum of children min heights", () => {
            const flex = new VFlexElement();
            flex.addChild(new FixedSizeElement(10, 3), { height: vflexFixed(3), width: 10 });
            flex.addChild(new FixedSizeElement(10, 6), { height: vflexFit(), width: 10 });

            expect(flex.getMinIntrinsicHeight(100)).toBe(3 + 6);
        });

        it("max intrinsic width is max of children widths", () => {
            const flex = new VFlexElement();
            flex.addChild(new FixedSizeElement(10, 3), { height: vflexFixed(3), width: 10 });
            flex.addChild(new FixedSizeElement(25, 3), { height: vflexFixed(3), width: 25 });

            expect(flex.getMaxIntrinsicWidth(100)).toBe(25);
        });

        it("delegates intrinsic width for fill-width children", () => {
            const flex = new VFlexElement();
            flex.addChild(new FixedSizeElement(30, 3), { height: vflexFixed(3), width: "fill" });
            flex.addChild(new FixedSizeElement(10, 3), { height: vflexFixed(3), width: 10 });

            expect(flex.getMaxIntrinsicWidth(100)).toBe(30);
        });
    });

    describe("getMinIntrinsicWidth", () => {
        it("is the max of fixed children's widths", () => {
            const flex = new VFlexElement();
            flex.addChild(new FixedSizeElement(10, 3), { height: vflexFixed(3), width: 10 });
            flex.addChild(new FixedSizeElement(40, 3), { height: vflexFixed(3), width: 40 });
            flex.addChild(new FixedSizeElement(20, 3), { height: vflexFixed(3), width: 20 });

            expect(flex.getMinIntrinsicWidth(100)).toBe(40);
        });

        it("delegates to child's min intrinsic width for fill-width children", () => {
            const flex = new VFlexElement();
            // FixedSizeElement reports min width 35; using width "fill" must delegate to it.
            flex.addChild(new FixedSizeElement(35, 3), { height: vflexFixed(3), width: "fill" });
            flex.addChild(new FixedSizeElement(10, 3), { height: vflexFixed(3), width: 10 });

            expect(flex.getMinIntrinsicWidth(100)).toBe(35);
        });

        it("is zero for an empty flex", () => {
            const flex = new VFlexElement();
            expect(flex.getMinIntrinsicWidth(100)).toBe(0);
        });
    });

    describe("replaceChildren", () => {
        it("throws when the new children contain more than one fill", () => {
            const flex = new VFlexElement();
            const a = new TUIElement();
            const b = new TUIElement();
            a.layoutStyle = { height: vflexFill(), width: 10 };
            b.layoutStyle = { height: vflexFill(), width: 10 };

            expect(() => {
                flex.replaceChildren([a, b]);
            }).toThrow("VFlexElement supports at most one fill child");
        });

        it("accepts a single fill among the new children and re-parents them", () => {
            const flex = new VFlexElement();
            const a = new TUIElement();
            const b = new TUIElement();
            a.layoutStyle = { height: vflexFixed(4), width: 10 };
            b.layoutStyle = { height: vflexFill(), width: 10 };

            flex.replaceChildren([a, b]);

            expect(flex.getChildren()).toEqual([a, b]);
            expect(a.getParent()).toBe(flex);
            expect(b.getParent()).toBe(flex);
        });

        it("detaches old children no longer present", () => {
            const flex = new VFlexElement();
            const old = new TUIElement();
            flex.addChild(old, { height: vflexFixed(4), width: 10 });

            const fresh = new TUIElement();
            fresh.layoutStyle = { height: vflexFixed(4), width: 10 };
            flex.replaceChildren([fresh]);

            expect(old.getParent()).toBeNull();
            expect(fresh.getParent()).toBe(flex);
        });
    });

    describe("overflow: fixed children exceed available height", () => {
        it("still lays out children at their fixed heights, running past the viewport", () => {
            const flex = new VFlexElement();
            const a = new TUIElement();
            const b = new TUIElement();
            flex.addChild(a, { height: vflexFixed(20), width: 10 });
            flex.addChild(b, { height: vflexFixed(20), width: 10 });

            layoutVFlex(flex, 80, 24); // container only 24 tall, children total 40

            expect(a.layoutSize.height).toBe(20);
            expect(b.layoutSize.height).toBe(20);
            expect(b.localPosition.dy).toBe(20);
        });

        it("fixed children exceeding height leave a fill child clamped to zero", () => {
            const flex = new VFlexElement();
            const a = new TUIElement();
            const b = new TUIElement();
            const fill = new TUIElement();
            // fixed heights total 30 > container 24, so remaining = max(0, 24-30) = 0
            flex.addChild(a, { height: vflexFixed(15), width: 10 });
            flex.addChild(b, { height: vflexFixed(15), width: 10 });
            flex.addChild(fill, { height: vflexFill(), width: 10 });

            layoutVFlex(flex, 80, 24);

            expect(a.layoutSize.height).toBe(15);
            expect(b.layoutSize.height).toBe(15);
            expect(fill.layoutSize.height).toBe(0);
            expect(fill.localPosition.dy).toBe(30);
        });

        it("fit children that exceed height leave no remaining space for fill (clamped to 0)", () => {
            const flex = new VFlexElement();
            const fit = new FixedSizeElement(10, 30);
            const fill = new TUIElement();
            flex.addChild(fit, { height: vflexFit(), width: 10 });
            flex.addChild(fill, { height: vflexFill(), width: 10 });

            layoutVFlex(flex, 80, 24);

            expect(fit.layoutSize.height).toBe(30);
            expect(fill.layoutSize.height).toBe(0); // remaining = max(0, 24 - 30) = 0
        });
    });

    describe("parent propagation", () => {
        it("children get parent set to VFlexElement", () => {
            const flex = new VFlexElement();
            const child = new TUIElement();
            flex.addChild(child, { height: vflexFixed(4), width: 10 });

            expect(child.getParent()).toBe(flex);
        });
    });
});
