import { describe, expect, it } from "vitest";

import { BoxConstraints, Offset, Point, Size } from "../common/geometryPromitives.ts";
import type { IContentSized } from "../ui/scrollbar/iScrollable.ts";
import { ScrollViewport } from "../ui/scrollbar/scrollViewport.ts";

import { TUIElement } from "./tuiElement.ts";

// ─── Helpers ───

// Scroll-контент по контракту (LAYOUT.md «Инвариант вложенности и клип») — ЛИСТ:
// рисует весь контент сам в локальных координатах, детей с контентными
// координатами не имеет (они нарушали бы инвариант вложенности Н2).
class ContentElement extends TUIElement implements IContentSized {
    public contentHeight: number;
    public contentWidth: number;

    public constructor(contentWidth: number, contentHeight: number) {
        super();
        this.contentWidth = contentWidth;
        this.contentHeight = contentHeight;
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

describe("ScrollViewport.elementFromPoint — контракт «контент — лист»", () => {
    it("возвращает контент в любой точке вьюпорта независимо от прокрутки", () => {
        const content = new ContentElement(80, 100);
        const viewport = new ScrollViewport(content);
        layoutElement(viewport, new Point(0, 0), new Size(80, 20));

        expect(viewport.elementFromPoint(new Point(15, 5))).toBe(content);
        viewport.scrollTo(0, 30);
        expect(viewport.elementFromPoint(new Point(15, 5))).toBe(content);
        viewport.scrollTo(40, 60);
        expect(viewport.elementFromPoint(new Point(79, 19))).toBe(content);
    });

    it("возвращает null вне границ вьюпорта", () => {
        const content = new ContentElement(80, 100);
        const viewport = new ScrollViewport(content);
        layoutElement(viewport, new Point(0, 0), new Size(80, 20));

        expect(viewport.elementFromPoint(new Point(0, 25))).toBeNull();
        expect(viewport.elementFromPoint(new Point(80, 5))).toBeNull();
    });

    it("учитывает собственную позицию вьюпорта на экране", () => {
        const content = new ContentElement(80, 100);
        const viewport = new ScrollViewport(content);
        layoutElement(viewport, new Point(10, 5), new Size(60, 15));
        viewport.scrollTo(0, 15);

        // Внутри вьюпорта (10..70, 5..20) — контент, независимо от прокрутки.
        expect(viewport.elementFromPoint(new Point(25, 12))).toBe(content);
        // Вне вьюпорта — null.
        expect(viewport.elementFromPoint(new Point(5, 3))).toBeNull();
    });
});
