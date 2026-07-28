import { describe, expect, it } from "vitest";

import { BoxConstraints, Offset, Point, Size } from "../../common/geometryPromitives.ts";
import { TUIElement } from "../../dom/tuiElement.ts";
import { TextBlockElement } from "../text/textBlockElement.ts";

import { HFlexElement, hflexFill, hflexFit, hflexFixed } from "./hFlexElement.ts";

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

function layoutHFlex(flex: HFlexElement, width = 80, height = 24): void {
    flex.localPosition = new Offset(0, 0);
    flex.layout(BoxConstraints.tight(new Size(width, height)));
}

describe("HFlexElement", () => {
    describe("all fixed children", () => {
        it("lays out children side by side with fixed widths", () => {
            const flex = new HFlexElement();
            const a = new TUIElement();
            const b = new TUIElement();
            const c = new TUIElement();

            flex.addChild(a, { width: hflexFixed(10), height: 5 });
            flex.addChild(b, { width: hflexFixed(20), height: 5 });
            flex.addChild(c, { width: hflexFixed(15), height: 5 });

            layoutHFlex(flex, 80, 24);

            expect(a.layoutSize).toEqual(new Size(10, 5));
            expect(b.layoutSize).toEqual(new Size(20, 5));
            expect(c.layoutSize).toEqual(new Size(15, 5));

            expect(a.localPosition.dx).toBe(0);
            expect(b.localPosition.dx).toBe(10);
            expect(c.localPosition.dx).toBe(30);
        });
    });

    describe("fixed + fit", () => {
        it("fit child gets its intrinsic width", () => {
            const flex = new HFlexElement();
            const fixed = new TUIElement();
            const fit = new FixedSizeElement(12, 3);

            flex.addChild(fixed, { width: hflexFixed(10), height: 5 });
            flex.addChild(fit, { width: hflexFit(), height: 5 });

            layoutHFlex(flex, 80, 24);

            expect(fixed.layoutSize.width).toBe(10);
            expect(fit.layoutSize.width).toBe(12);
            expect(fit.localPosition.dx).toBe(10);
        });
    });

    describe("fixed + fill", () => {
        it("fill child takes remaining space", () => {
            const flex = new HFlexElement();
            const fixed = new TUIElement();
            const fill = new TUIElement();

            flex.addChild(fixed, { width: hflexFixed(20), height: 5 });
            flex.addChild(fill, { width: hflexFill(), height: 5 });

            layoutHFlex(flex, 80, 24);

            expect(fixed.layoutSize.width).toBe(20);
            expect(fill.layoutSize.width).toBe(60);
            expect(fill.localPosition.dx).toBe(20);
        });
    });

    describe("fixed + fit + fill", () => {
        it("allocates fixed, then fit, then remaining to fill", () => {
            const flex = new HFlexElement();
            const fixed = new TUIElement();
            const fit = new FixedSizeElement(15, 3);
            const fill = new TUIElement();

            flex.addChild(fixed, { width: hflexFixed(10), height: 5 });
            flex.addChild(fit, { width: hflexFit(), height: 5 });
            flex.addChild(fill, { width: hflexFill(), height: 5 });

            layoutHFlex(flex, 80, 24);

            expect(fixed.layoutSize.width).toBe(10);
            expect(fit.layoutSize.width).toBe(15);
            expect(fill.layoutSize.width).toBe(55);

            expect(fixed.localPosition.dx).toBe(0);
            expect(fit.localPosition.dx).toBe(10);
            expect(fill.localPosition.dx).toBe(25);
        });
    });

    describe("fill gets zero when no space left", () => {
        it("fill child gets 0 width when fixed children consume all space", () => {
            const flex = new HFlexElement();
            const fixed = new TUIElement();
            const fill = new TUIElement();

            flex.addChild(fixed, { width: hflexFixed(80), height: 5 });
            flex.addChild(fill, { width: hflexFill(), height: 5 });

            layoutHFlex(flex, 80, 24);

            expect(fill.layoutSize.width).toBe(0);
        });
    });

    describe("cross axis: height fill", () => {
        it("fill height child takes container height", () => {
            const flex = new HFlexElement();
            const child = new TUIElement();

            flex.addChild(child, { width: hflexFixed(10), height: "fill" });

            layoutHFlex(flex, 80, 24);

            expect(child.layoutSize.height).toBe(24);
        });

        it("fixed height child keeps its height", () => {
            const flex = new HFlexElement();
            const child = new TUIElement();

            flex.addChild(child, { width: hflexFixed(10), height: 7 });

            layoutHFlex(flex, 80, 24);

            expect(child.layoutSize.height).toBe(7);
        });
    });

    describe("error on second fill", () => {
        it("throws when adding a second fill child", () => {
            const flex = new HFlexElement();
            flex.addChild(new TUIElement(), { width: hflexFill(), height: 5 });

            expect(() => {
                flex.addChild(new TUIElement(), { width: hflexFill(), height: 5 });
            }).toThrow("HFlexElement supports at most one fill child");
        });
    });

    describe("global positions", () => {
        it("sets correct global positions for children", () => {
            const flex = new HFlexElement();
            flex.localPosition = new Offset(5, 10);

            const a = new TUIElement();
            const b = new TUIElement();
            flex.addChild(a, { width: hflexFixed(20), height: 5 });
            flex.addChild(b, { width: hflexFixed(30), height: 5 });

            flex.layout(BoxConstraints.tight(new Size(80, 24)));

            expect(a.globalPosition).toEqual(new Point(5, 10));
            expect(b.globalPosition).toEqual(new Point(25, 10));
        });
    });

    describe("intrinsic size of HFlexElement itself", () => {
        it("max intrinsic width is sum of children widths", () => {
            const flex = new HFlexElement();
            flex.addChild(new FixedSizeElement(10, 3), { width: hflexFixed(10), height: 3 });
            flex.addChild(new FixedSizeElement(15, 3), { width: hflexFit(), height: 3 });
            flex.addChild(new FixedSizeElement(20, 3), { width: hflexFill(), height: 3 });

            expect(flex.getMaxIntrinsicWidth(100)).toBe(10 + 15 + 20);
        });

        it("min intrinsic width is sum of children min widths", () => {
            const flex = new HFlexElement();
            flex.addChild(new FixedSizeElement(10, 3), { width: hflexFixed(10), height: 3 });
            flex.addChild(new FixedSizeElement(15, 3), { width: hflexFit(), height: 3 });

            expect(flex.getMinIntrinsicWidth(100)).toBe(10 + 15);
        });

        it("max intrinsic height is max of children heights", () => {
            const flex = new HFlexElement();
            flex.addChild(new FixedSizeElement(10, 3), { width: hflexFixed(10), height: 3 });
            flex.addChild(new FixedSizeElement(10, 7), { width: hflexFixed(10), height: 7 });

            expect(flex.getMaxIntrinsicHeight(100)).toBe(7);
        });

        it("delegates intrinsic height for fill-height children", () => {
            const flex = new HFlexElement();
            flex.addChild(new FixedSizeElement(10, 5), { width: hflexFixed(10), height: "fill" });
            flex.addChild(new FixedSizeElement(10, 3), { width: hflexFixed(10), height: 3 });

            expect(flex.getMaxIntrinsicHeight(100)).toBe(5);
        });
    });

    describe("getMinIntrinsicHeight", () => {
        it("is the max of fixed children's heights", () => {
            const flex = new HFlexElement();
            flex.addChild(new FixedSizeElement(10, 3), { width: hflexFixed(10), height: 3 });
            flex.addChild(new FixedSizeElement(10, 9), { width: hflexFixed(10), height: 9 });
            flex.addChild(new FixedSizeElement(10, 5), { width: hflexFixed(10), height: 5 });

            expect(flex.getMinIntrinsicHeight(100)).toBe(9);
        });

        it("delegates to child's min intrinsic height for fill-height children", () => {
            const flex = new HFlexElement();
            // FixedSizeElement reports min height 6; using height "fill" must delegate to it.
            flex.addChild(new FixedSizeElement(10, 6), { width: hflexFixed(10), height: "fill" });
            flex.addChild(new FixedSizeElement(10, 2), { width: hflexFixed(10), height: 2 });

            expect(flex.getMinIntrinsicHeight(100)).toBe(6);
        });

        it("is zero for an empty flex", () => {
            const flex = new HFlexElement();
            expect(flex.getMinIntrinsicHeight(100)).toBe(0);
        });
    });

    describe("replaceChildren", () => {
        it("throws when the new children contain more than one fill", () => {
            const flex = new HFlexElement();
            const a = new TUIElement();
            const b = new TUIElement();
            a.layoutStyle = { width: hflexFill(), height: 5 };
            b.layoutStyle = { width: hflexFill(), height: 5 };

            expect(() => {
                flex.replaceChildren([a, b]);
            }).toThrow("HFlexElement supports at most one fill child");
        });

        it("accepts a single fill among the new children and re-parents them", () => {
            const flex = new HFlexElement();
            const a = new TUIElement();
            const b = new TUIElement();
            a.layoutStyle = { width: hflexFixed(10), height: 5 };
            b.layoutStyle = { width: hflexFill(), height: 5 };

            flex.replaceChildren([a, b]);

            expect(flex.getChildren()).toEqual([a, b]);
            expect(a.getParent()).toBe(flex);
            expect(b.getParent()).toBe(flex);
        });

        it("detaches old children no longer present", () => {
            const flex = new HFlexElement();
            const old = new TUIElement();
            flex.addChild(old, { width: hflexFixed(10), height: 5 });

            const fresh = new TUIElement();
            fresh.layoutStyle = { width: hflexFixed(10), height: 5 };
            flex.replaceChildren([fresh]);

            expect(old.getParent()).toBeNull();
            expect(fresh.getParent()).toBe(flex);
        });
    });

    describe("overflow: fixed children exceed available width", () => {
        it("still lays out children at their fixed widths, running past the viewport", () => {
            const flex = new HFlexElement();
            const a = new TUIElement();
            const b = new TUIElement();
            flex.addChild(a, { width: hflexFixed(60), height: 5 });
            flex.addChild(b, { width: hflexFixed(60), height: 5 });

            layoutHFlex(flex, 80, 24); // container only 80 wide, children total 120

            expect(a.layoutSize.width).toBe(60);
            expect(b.layoutSize.width).toBe(60);
            expect(b.localPosition.dx).toBe(60); // second child starts past the container edge contribution
        });

        it("fixed children exceeding width leave a fill child clamped to zero", () => {
            const flex = new HFlexElement();
            const a = new TUIElement();
            const b = new TUIElement();
            const fill = new TUIElement();
            // fixed widths total 100 > container 80, so remaining = max(0, 80-100) = 0
            flex.addChild(a, { width: hflexFixed(50), height: 5 });
            flex.addChild(b, { width: hflexFixed(50), height: 5 });
            flex.addChild(fill, { width: hflexFill(), height: 5 });

            layoutHFlex(flex, 80, 24);

            expect(a.layoutSize.width).toBe(50);
            expect(b.layoutSize.width).toBe(50);
            expect(fill.layoutSize.width).toBe(0);
            // fill is positioned right after the overflowing fixed children
            expect(fill.localPosition.dx).toBe(100);
        });

        it("fit children that exceed width leave no remaining space for fill (clamped to 0)", () => {
            const flex = new HFlexElement();
            const fit = new FixedSizeElement(100, 5);
            const fill = new TUIElement();
            flex.addChild(fit, { width: hflexFit(), height: 5 });
            flex.addChild(fill, { width: hflexFill(), height: 5 });

            layoutHFlex(flex, 80, 24);

            expect(fit.layoutSize.width).toBe(100);
            expect(fill.layoutSize.width).toBe(0); // remaining = max(0, 80 - 100) = 0
        });
    });

    describe("getChildren", () => {
        it("returns all added children", () => {
            const flex = new HFlexElement();
            const a = new TUIElement();
            const b = new TUIElement();
            flex.addChild(a, { width: hflexFixed(10), height: 5 });
            flex.addChild(b, { width: hflexFixed(10), height: 5 });

            expect(flex.getChildren()).toEqual([a, b]);
        });
    });

    describe("parent propagation", () => {
        it("children get parent set to HFlexElement", () => {
            const flex = new HFlexElement();
            const child = new TUIElement();
            flex.addChild(child, { width: hflexFixed(10), height: 5 });

            expect(child.getParent()).toBe(flex);
        });
    });
});
