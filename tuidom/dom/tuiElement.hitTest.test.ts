import { describe, expect, it } from "vitest";

import { BoxConstraints, Offset, Point, Size } from "../common/geometryPromitives.ts";

import { TUIElement } from "./tuiElement.ts";

// ─── Helpers ───

class ContainerElement extends TUIElement {
    public addChild(child: TUIElement): void {
        this.appendChild(child);
    }
}

// Тесты задают позиции АБСОЛЮТНЫМИ координатами; globalPosition производный,
// поэтому пересчитываем в локальные относительно уже прикреплённого родителя.
function layoutElement(el: TUIElement, globalPos: Point, size: Size): void {
    const base = el.getParent()?.globalPosition ?? new Point(0, 0);
    el.localPosition = new Offset(globalPos.x - base.x, globalPos.y - base.y);
    el.layout(BoxConstraints.tight(size));
}

// ─── Tests ───

describe("elementFromPoint — single element", () => {
    it("returns element when point is inside", () => {
        const el = new TUIElement();
        layoutElement(el, new Point(0, 0), new Size(80, 24));

        expect(el.elementFromPoint(new Point(10, 5))).toBe(el);
    });

    it("returns element at top-left boundary (inclusive)", () => {
        const el = new TUIElement();
        layoutElement(el, new Point(5, 3), new Size(20, 10));

        expect(el.elementFromPoint(new Point(5, 3))).toBe(el);
    });

    it("returns null at right boundary (exclusive)", () => {
        const el = new TUIElement();
        layoutElement(el, new Point(5, 3), new Size(20, 10));

        // right = 5 + 20 = 25
        expect(el.elementFromPoint(new Point(25, 5))).toBeNull();
    });

    it("returns null at bottom boundary (exclusive)", () => {
        const el = new TUIElement();
        layoutElement(el, new Point(5, 3), new Size(20, 10));

        // bottom = 3 + 10 = 13
        expect(el.elementFromPoint(new Point(10, 13))).toBeNull();
    });

    it("returns null when point is outside", () => {
        const el = new TUIElement();
        layoutElement(el, new Point(10, 10), new Size(5, 5));

        expect(el.elementFromPoint(new Point(0, 0))).toBeNull();
    });

    it("returns null for element with zero size", () => {
        const el = new TUIElement();
        layoutElement(el, new Point(10, 10), new Size(0, 0));

        expect(el.elementFromPoint(new Point(10, 10))).toBeNull();
    });
});

describe("elementFromPoint — flat structure (root → children)", () => {
    it("returns correct child in side-by-side layout", () => {
        const root = new ContainerElement();
        layoutElement(root, new Point(0, 0), new Size(80, 24));

        const child1 = new TUIElement();
        root.addChild(child1);
        layoutElement(child1, new Point(0, 0), new Size(40, 24));

        const child2 = new TUIElement();
        root.addChild(child2);
        layoutElement(child2, new Point(40, 0), new Size(40, 24));

        expect(root.elementFromPoint(new Point(10, 5))).toBe(child1);
        expect(root.elementFromPoint(new Point(50, 5))).toBe(child2);
    });

    it("returns root when point is outside all children but inside root", () => {
        const root = new ContainerElement();
        layoutElement(root, new Point(0, 0), new Size(80, 24));

        const child = new TUIElement();
        root.addChild(child);
        layoutElement(child, new Point(10, 10), new Size(20, 10));

        expect(root.elementFromPoint(new Point(5, 5))).toBe(root);
    });

    it("returns last child when overlapping (z-order: last = topmost)", () => {
        const root = new ContainerElement();
        layoutElement(root, new Point(0, 0), new Size(80, 24));

        const child1 = new TUIElement();
        root.addChild(child1);
        layoutElement(child1, new Point(0, 0), new Size(20, 10));

        const child2 = new TUIElement();
        root.addChild(child2);
        layoutElement(child2, new Point(5, 5), new Size(20, 10));

        // Point (10, 7) is inside both children; child2 should win
        expect(root.elementFromPoint(new Point(10, 7))).toBe(child2);
    });

    it("returns first child when point only hits first", () => {
        const root = new ContainerElement();
        layoutElement(root, new Point(0, 0), new Size(80, 24));

        const child1 = new TUIElement();
        root.addChild(child1);
        layoutElement(child1, new Point(0, 0), new Size(20, 10));

        const child2 = new TUIElement();
        root.addChild(child2);
        layoutElement(child2, new Point(30, 0), new Size(20, 10));

        expect(root.elementFromPoint(new Point(5, 5))).toBe(child1);
    });
});

describe("elementFromPoint — deep nesting", () => {
    it("finds leaf in deeply nested tree", () => {
        const root = new ContainerElement();
        layoutElement(root, new Point(0, 0), new Size(80, 24));

        const container = new ContainerElement();
        root.addChild(container);
        layoutElement(container, new Point(5, 2), new Size(70, 20));

        const inner = new ContainerElement();
        container.addChild(inner);
        layoutElement(inner, new Point(10, 5), new Size(50, 10));

        const leaf = new TUIElement();
        inner.addChild(leaf);
        layoutElement(leaf, new Point(15, 7), new Size(30, 5));

        expect(root.elementFromPoint(new Point(20, 9))).toBe(leaf);
    });

    it("returns container when point is outside inner but inside container", () => {
        const root = new ContainerElement();
        layoutElement(root, new Point(0, 0), new Size(80, 24));

        const container = new ContainerElement();
        root.addChild(container);
        layoutElement(container, new Point(5, 2), new Size(70, 20));

        const inner = new TUIElement();
        container.addChild(inner);
        layoutElement(inner, new Point(10, 5), new Size(50, 10));

        // Point (7, 3) is inside container but outside inner
        expect(root.elementFromPoint(new Point(7, 3))).toBe(container);
    });

    it("returns root when point is outside container", () => {
        const root = new ContainerElement();
        layoutElement(root, new Point(0, 0), new Size(80, 24));

        const container = new ContainerElement();
        root.addChild(container);
        layoutElement(container, new Point(5, 2), new Size(70, 20));

        // Point (2, 1) is inside root but outside container
        expect(root.elementFromPoint(new Point(2, 1))).toBe(root);
    });
});

describe("elementFromPoint — multiple containers (horizontal split)", () => {
    it("finds correct item across panels", () => {
        const root = new ContainerElement();
        layoutElement(root, new Point(0, 0), new Size(80, 24));

        const panelA = new ContainerElement();
        root.addChild(panelA);
        layoutElement(panelA, new Point(0, 0), new Size(40, 24));

        const itemA1 = new TUIElement();
        panelA.addChild(itemA1);
        layoutElement(itemA1, new Point(0, 0), new Size(40, 12));

        const itemA2 = new TUIElement();
        panelA.addChild(itemA2);
        layoutElement(itemA2, new Point(0, 12), new Size(40, 12));

        const panelB = new ContainerElement();
        root.addChild(panelB);
        layoutElement(panelB, new Point(40, 0), new Size(40, 24));

        const itemB1 = new TUIElement();
        panelB.addChild(itemB1);
        layoutElement(itemB1, new Point(40, 5), new Size(30, 10));

        // Point inside itemA2
        expect(root.elementFromPoint(new Point(20, 15))).toBe(itemA2);
        // Point inside itemB1
        expect(root.elementFromPoint(new Point(50, 10))).toBe(itemB1);
        // Point inside panelB but outside itemB1
        expect(root.elementFromPoint(new Point(45, 2))).toBe(panelB);
    });
});

describe("elementFromPoint — nested containers with offsets", () => {
    it("correctly resolves through offset hierarchy", () => {
        const root = new ContainerElement();
        layoutElement(root, new Point(0, 0), new Size(80, 24));

        const panel = new ContainerElement();
        root.addChild(panel);
        layoutElement(panel, new Point(5, 3), new Size(70, 18));

        const widget = new TUIElement();
        panel.addChild(widget);
        layoutElement(widget, new Point(10, 5), new Size(50, 10));

        // Inside widget
        expect(root.elementFromPoint(new Point(15, 10))).toBe(widget);
        // Inside panel but outside widget
        expect(root.elementFromPoint(new Point(6, 4))).toBe(panel);
        // Inside root but outside panel
        expect(root.elementFromPoint(new Point(2, 1))).toBe(root);
    });
});

describe("elementFromPoint — edge cases", () => {
    it("empty container returns itself", () => {
        const container = new ContainerElement();
        layoutElement(container, new Point(0, 0), new Size(40, 20));

        expect(container.elementFromPoint(new Point(10, 10))).toBe(container);
    });

    it("returns null for point outside root", () => {
        const root = new ContainerElement();
        layoutElement(root, new Point(10, 10), new Size(20, 10));

        expect(root.elementFromPoint(new Point(5, 5))).toBeNull();
    });

    it("three levels of containers with single leaf", () => {
        const root = new ContainerElement();
        layoutElement(root, new Point(0, 0), new Size(100, 50));

        const level1 = new ContainerElement();
        root.addChild(level1);
        layoutElement(level1, new Point(10, 10), new Size(80, 30));

        const level2 = new ContainerElement();
        level1.addChild(level2);
        layoutElement(level2, new Point(20, 15), new Size(60, 20));

        const leaf = new TUIElement();
        level2.addChild(leaf);
        layoutElement(leaf, new Point(30, 20), new Size(40, 10));

        expect(root.elementFromPoint(new Point(35, 25))).toBe(leaf);
        expect(root.elementFromPoint(new Point(25, 17))).toBe(level2);
        expect(root.elementFromPoint(new Point(15, 12))).toBe(level1);
        expect(root.elementFromPoint(new Point(5, 5))).toBe(root);
    });

    it("many siblings — finds correct one", () => {
        const root = new ContainerElement();
        layoutElement(root, new Point(0, 0), new Size(100, 10));

        const children: TUIElement[] = [];
        for (let i = 0; i < 10; i++) {
            const child = new TUIElement();
            root.addChild(child);
            layoutElement(child, new Point(i * 10, 0), new Size(10, 10));
            children.push(child);
        }

        expect(root.elementFromPoint(new Point(5, 5))).toBe(children[0]);
        expect(root.elementFromPoint(new Point(55, 5))).toBe(children[5]);
        expect(root.elementFromPoint(new Point(95, 5))).toBe(children[9]);
    });
});
