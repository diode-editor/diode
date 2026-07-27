import { describe, expect, it } from "vitest";

import { BoxConstraints, Offset, Point, Size } from "../common/geometryPromitives.ts";
import type { IContentSized } from "../ui/scrollbar/iScrollable.ts";
import { ScrollViewport } from "../ui/scrollbar/scrollViewport.ts";

import { TUIElement } from "./tuiElement.ts";

// ─── Helpers ───

class ContentElement extends TUIElement implements IContentSized {
    public contentHeight: number;
    public contentWidth: number;

    private children: TUIElement[] = [];

    public constructor(contentWidth: number, contentHeight: number) {
        super();
        this.contentWidth = contentWidth;
        this.contentHeight = contentHeight;
    }

    public addChild(child: TUIElement): void {
        this.appendChild(child);
    }
}

// Тесты задают позиции АБСОЛЮТНЫМИ координатами; globalPosition производный,
// поэтому пересчитываем в локальные относительно уже прикреплённого родителя.
function layoutElement(el: TUIElement, globalPos: Point, size: Size): void {
    const base = el.getParent()?.globalPosition ?? new Point(0, 0);
    el.localPosition = new Offset(globalPos.x - base.x, globalPos.y - base.y);
    el.performLayout(BoxConstraints.tight(size));
}

// ─── Tests ───

describe("ScrollViewport.elementFromPoint — vertical scroll", () => {
    it("adjusts point by scrollTop to find content element", () => {
        const content = new ContentElement(80, 100);
        const viewport = new ScrollViewport(content);

        // Layout viewport at (0,0) with size 80x20
        layoutElement(viewport, new Point(0, 0), new Size(80, 20));
        // Content gets same global position as viewport
        content.localPosition = new Offset(0, 0);
        content.performLayout(BoxConstraints.tight(new Size(80, 20)));

        // Place a child inside content at y=35 (visible only when scrolled)
        const child = new TUIElement();
        content.addChild(child);
        layoutElement(child, new Point(10, 30), new Size(20, 10));

        // Scroll down by 30
        viewport.scrollTo(0, 30);

        // Screen point (15, 5) → content y = 5 + 30 = 35, which is inside child (30..40)
        expect(viewport.elementFromPoint(new Point(15, 5))).toBe(child);
    });

    it("returns content when scrolled point misses child", () => {
        const content = new ContentElement(80, 100);
        const viewport = new ScrollViewport(content);

        layoutElement(viewport, new Point(0, 0), new Size(80, 20));
        content.localPosition = new Offset(0, 0);
        content.performLayout(BoxConstraints.tight(new Size(80, 20)));

        const child = new TUIElement();
        content.addChild(child);
        layoutElement(child, new Point(10, 50), new Size(20, 10));

        viewport.scrollTo(0, 0);

        // Without scroll, point (15, 5) maps to content y=5, which misses child at 50..60
        expect(viewport.elementFromPoint(new Point(15, 5))).toBe(content);
    });

    it("returns null when point is outside viewport bounds", () => {
        const content = new ContentElement(80, 100);
        const viewport = new ScrollViewport(content);

        layoutElement(viewport, new Point(0, 0), new Size(80, 20));

        // Point outside viewport
        expect(viewport.elementFromPoint(new Point(0, 25))).toBeNull();
    });
});

describe("ScrollViewport.elementFromPoint — horizontal scroll", () => {
    it("adjusts point by scrollLeft to find content element", () => {
        const content = new ContentElement(200, 20);
        const viewport = new ScrollViewport(content);

        layoutElement(viewport, new Point(0, 0), new Size(80, 20));
        content.localPosition = new Offset(0, 0);
        content.performLayout(BoxConstraints.tight(new Size(80, 20)));

        const child = new TUIElement();
        content.addChild(child);
        layoutElement(child, new Point(100, 5), new Size(20, 10));

        viewport.scrollTo(90, 0);

        // Screen x=15, scrollLeft=90 → content x = 15 + 90 = 105, inside child (100..120)
        expect(viewport.elementFromPoint(new Point(15, 8))).toBe(child);
    });
});

describe("ScrollViewport.elementFromPoint — both axes", () => {
    it("adjusts point by both scrollLeft and scrollTop", () => {
        const content = new ContentElement(200, 200);
        const viewport = new ScrollViewport(content);

        layoutElement(viewport, new Point(0, 0), new Size(80, 20));
        content.localPosition = new Offset(0, 0);
        content.performLayout(BoxConstraints.tight(new Size(80, 20)));

        const child = new TUIElement();
        content.addChild(child);
        layoutElement(child, new Point(100, 100), new Size(20, 10));

        viewport.scrollTo(95, 95);

        // Screen (10, 8) → content (105, 103), inside child (100..120, 100..110)
        expect(viewport.elementFromPoint(new Point(10, 8))).toBe(child);
    });
});

describe("ScrollViewport.elementFromPoint — offset viewport", () => {
    it("respects viewport's own global position", () => {
        const content = new ContentElement(80, 100);
        const viewport = new ScrollViewport(content);

        // Viewport starts at (10, 5) on screen; its layout positions content at
        // the viewport origin — content.globalPosition выводится сам.
        layoutElement(viewport, new Point(10, 5), new Size(60, 15));

        const child = new TUIElement();
        content.addChild(child);
        layoutElement(child, new Point(10, 20), new Size(40, 10));

        viewport.scrollTo(0, 15);

        // Screen point (25, 12) is inside viewport (10..70, 5..20)
        // Content point: (25 + 0, 12 + 15) = (25, 27), inside child (10..50, 20..30)
        expect(viewport.elementFromPoint(new Point(25, 12))).toBe(child);

        // Screen point (5, 3) is outside viewport
        expect(viewport.elementFromPoint(new Point(5, 3))).toBeNull();
    });
});
