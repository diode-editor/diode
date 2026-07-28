import { describe, expect, it } from "vitest";

import { BoxConstraints, Size } from "../common/geometryPromitives.ts";
import { VStackElement } from "../ui/layout/vStackElement.ts";
import { PopupMenuElement } from "../ui/menu/popupMenuElement.ts";
import { TextBlockElement } from "../ui/text/textBlockElement.ts";

import { TUIElement } from "./tuiElement.ts";

describe("Intrinsic Size API", () => {
    describe("TUIElement base", () => {
        it("returns 0 for all intrinsic methods", () => {
            const el = new TUIElement();
            expect(el.getMinIntrinsicWidth(100)).toBe(0);
            expect(el.getMaxIntrinsicWidth(100)).toBe(0);
            expect(el.getMinIntrinsicHeight(100)).toBe(0);
            expect(el.getMaxIntrinsicHeight(100)).toBe(0);
        });
    });

    describe("TextBlockElement", () => {
        it("returns content dimensions", () => {
            const el = new TextBlockElement(5);
            expect(el.getMaxIntrinsicWidth(100)).toBe(el.contentWidth);
            expect(el.getMinIntrinsicWidth(100)).toBe(el.contentWidth);
            expect(el.getMaxIntrinsicHeight(100)).toBe(5);
            expect(el.getMinIntrinsicHeight(100)).toBe(5);
        });
    });

    describe("PopupMenuElement", () => {
        it("returns intrinsic size from entries", () => {
            const el = new PopupMenuElement([
                { label: "Open", shortcut: "Ctrl+O" },
                { label: "Save As", shortcut: "Ctrl+Shift+S" },
                { type: "separator" },
                { label: "Exit" },
            ]);
            const intrinsic = el.getIntrinsicSize();
            expect(el.getMaxIntrinsicWidth(100)).toBe(intrinsic.width);
            expect(el.getMinIntrinsicWidth(100)).toBe(intrinsic.width);
            expect(el.getMaxIntrinsicHeight(100)).toBe(intrinsic.height);
            expect(el.getMinIntrinsicHeight(100)).toBe(intrinsic.height);
        });
    });

    describe("VStackElement", () => {
        it("returns max width of fixed children", () => {
            const stack = new VStackElement();
            const child1 = new TextBlockElement(3);
            const child2 = new TextBlockElement(5);
            stack.addChild(child1, { width: 20, height: 3 });
            stack.addChild(child2, { width: 30, height: 5 });
            expect(stack.getMaxIntrinsicWidth(100)).toBe(30);
            expect(stack.getMinIntrinsicWidth(100)).toBe(30);
        });

        it("returns sum of children heights", () => {
            const stack = new VStackElement();
            stack.addChild(new TextBlockElement(3), { width: 20, height: 3 });
            stack.addChild(new TextBlockElement(5), { width: 20, height: 5 });
            expect(stack.getMaxIntrinsicHeight(100)).toBe(8);
            expect(stack.getMinIntrinsicHeight(100)).toBe(8);
        });

        it("delegates intrinsic width for fill children", () => {
            const stack = new VStackElement();
            const child = new TextBlockElement(3);
            stack.addChild(child, { width: "fill", height: 3 });
            expect(stack.getMaxIntrinsicWidth(100)).toBe(child.contentWidth);
        });

        it("delegates intrinsic width for stretch children", () => {
            const stack = new VStackElement();
            const child = new TextBlockElement(3);
            stack.addChild(child, { width: "stretch", height: 3 });
            expect(stack.getMaxIntrinsicWidth(100)).toBe(child.contentWidth);
            expect(stack.getMinIntrinsicWidth(100)).toBe(child.contentWidth);
        });

        it("stretch children get container width in layout", () => {
            const stack = new VStackElement();
            const child = new TUIElement();
            stack.addChild(child, { width: "stretch", height: 1 });
            stack.layout(BoxConstraints.tight(new Size(40, 10)));
            expect(child.layoutSize.width).toBe(40);
            expect(child.layoutSize.height).toBe(1);
        });
    });
});
