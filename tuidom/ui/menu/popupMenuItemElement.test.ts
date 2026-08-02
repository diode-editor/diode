import { describe, expect, it, vi } from "vitest";

import { MockTerminalBackend } from "../../backend/mockTerminalBackend.ts";
import { BoxConstraints, Offset, Point, Size } from "../../common/geometryPromitives.ts";
import { TUIMouseEvent } from "../../dom/events/tuiMouseEvent.ts";
import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";
import { TerminalScreen } from "../../rendering/terminalScreen.ts";

import type { PopupMenuItemConfig } from "./popupMenuItemElement.ts";
import { PopupMenuItemElement, PopupMenuSeparatorElement } from "./popupMenuItemElement.ts";

function renderItem(item: PopupMenuItemElement, width?: number): string {
    const intrinsicWidth = width ?? item.getMaxIntrinsicWidth(1);
    const size = new Size(intrinsicWidth, 1);
    const backend = new MockTerminalBackend(size);
    const termScreen = new TerminalScreen(size);
    item.localPosition = new Offset(0, 0);
    item.layout(BoxConstraints.tight(size));
    item.render(new RenderContext(termScreen));
    termScreen.flush(backend);
    return backend.getTextAt(new Point(0, 0), intrinsicWidth);
}

const simpleConfig: PopupMenuItemConfig = { hasIconColumn: false, hasShortcuts: false };
const shortcutConfig: PopupMenuItemConfig = { hasIconColumn: false, hasShortcuts: true };
const iconConfig: PopupMenuItemConfig = { hasIconColumn: true, hasShortcuts: false };

function fireClickOn(el: TUIElement): void {
    el.dispatchEvent(new TUIMouseEvent("click", { button: "left", screenX: 0, screenY: 0, localX: 0, localY: 0 }));
}

function fireMouseMoveOn(el: TUIElement): void {
    el.dispatchEvent(new TUIMouseEvent("mousemove", { button: "none", screenX: 0, screenY: 0, localX: 0, localY: 0 }));
}

function findDeepestChild(el: TUIElement): TUIElement {
    const children = el.getChildren();
    if (children.length === 0) return el;
    return findDeepestChild(children[0]);
}

describe("PopupMenuItemElement", () => {
    describe("rendering", () => {
        it("ends with trailing space when shortcut is present", () => {
            const item = new PopupMenuItemElement("Cut", shortcutConfig, "Ctrl+K");
            const text = renderItem(item);
            expect(text.endsWith(" ")).toBe(true);
            expect(text.endsWith("K")).toBe(false);
        });

        it("ends with trailing space when no shortcut", () => {
            const item = new PopupMenuItemElement("Cut", simpleConfig);
            const text = renderItem(item);
            expect(text.endsWith(" ")).toBe(true);
        });
    });

    describe("click handling", () => {
        it("calls onSelect when click dispatched on element itself", () => {
            const item = new PopupMenuItemElement("Cut", simpleConfig);
            item.setAsRoot();
            const handler = vi.fn();
            item.onSelect = handler;

            fireClickOn(item);

            expect(handler).toHaveBeenCalledOnce();
        });

        it("calls onSelect when click dispatched on child (bubbling)", () => {
            const item = new PopupMenuItemElement("Cut", simpleConfig);
            item.setAsRoot();
            const handler = vi.fn();
            item.onSelect = handler;

            const deepChild = findDeepestChild(item);
            fireClickOn(deepChild);

            expect(handler).toHaveBeenCalledOnce();
        });

        it("does not call onSelect when event is defaultPrevented", () => {
            const item = new PopupMenuItemElement("Cut", simpleConfig);
            item.setAsRoot();
            const handler = vi.fn();
            item.onSelect = handler;

            const event = new TUIMouseEvent("click", {
                button: "left",
                screenX: 0,
                screenY: 0,
                localX: 0,
                localY: 0,
            });
            event.preventDefault();
            item.dispatchEvent(event);

            expect(handler).not.toHaveBeenCalled();
        });

        it("calls onSelect set after construction", () => {
            const item = new PopupMenuItemElement("Cut", simpleConfig);
            item.setAsRoot();

            const handler = vi.fn();
            item.onSelect = handler;

            fireClickOn(item);

            expect(handler).toHaveBeenCalledOnce();
        });
    });

    describe("hover handling", () => {
        it("calls onHover on mousemove", () => {
            const item = new PopupMenuItemElement("Cut", simpleConfig);
            item.setAsRoot();
            const handler = vi.fn();
            item.onHover = handler;

            fireMouseMoveOn(item);

            expect(handler).toHaveBeenCalledOnce();
        });

        it("does not call onHover when event is defaultPrevented", () => {
            const item = new PopupMenuItemElement("Cut", simpleConfig);
            item.setAsRoot();
            const handler = vi.fn();
            item.onHover = handler;

            const event = new TUIMouseEvent("mousemove", {
                button: "none",
                screenX: 0,
                screenY: 0,
                localX: 0,
                localY: 0,
            });
            event.preventDefault();
            item.dispatchEvent(event);

            expect(handler).not.toHaveBeenCalled();
        });

        it("does not throw on mousemove without an onHover handler", () => {
            const item = new PopupMenuItemElement("Cut", simpleConfig);
            item.setAsRoot();
            expect(() => {
                fireMouseMoveOn(item);
            }).not.toThrow();
        });
    });

    describe("selected state", () => {
        it("selected getter reflects the assigned value", () => {
            const item = new PopupMenuItemElement("Cut", simpleConfig);
            expect(item.selected).toBe(false);
            item.selected = true;
            expect(item.selected).toBe(true);
            item.selected = false;
            expect(item.selected).toBe(false);
        });

        it("a selected item still renders its label (highlight describe() branch)", () => {
            const item = new PopupMenuItemElement("Cut", simpleConfig);
            item.selected = true;
            const text = renderItem(item);
            expect(text).toContain("Cut");
        });

        it("setting selected to the same value is a no-op for the getter", () => {
            const item = new PopupMenuItemElement("Cut", simpleConfig);
            item.selected = true;
            item.selected = true; // no-op early-return branch
            expect(item.selected).toBe(true);

            const text = renderItem(item);
            expect(text).toContain("Cut");
        });
    });

    describe("icon column", () => {
        it("renders the icon followed by a space in the icon column", () => {
            const item = new PopupMenuItemElement("Open", iconConfig, undefined, "*");
            const text = renderItem(item);
            // Icon column is 2 wide: "* " then a leading content space, then the label.
            expect(text.startsWith("* ")).toBe(true);
            expect(text).toContain("Open");
        });

        it("renders a blank icon column when no icon is provided", () => {
            const item = new PopupMenuItemElement("Open", iconConfig);
            const text = renderItem(item);
            // The 2-wide icon column is spaces.
            expect(text.startsWith("  ")).toBe(true);
            expect(text).toContain("Open");
        });
    });
});

describe("PopupMenuSeparatorElement", () => {
    it("has zero intrinsic width and unit height", () => {
        const sep = new PopupMenuSeparatorElement();
        expect(sep.getMinIntrinsicWidth(1)).toBe(0);
        expect(sep.getMaxIntrinsicWidth(1)).toBe(0);
        expect(sep.getMinIntrinsicHeight(10)).toBe(1);
        expect(sep.getMaxIntrinsicHeight(10)).toBe(1);
    });

    it("renders a horizontal rule across its full width", () => {
        const sep = new PopupMenuSeparatorElement();
        const size = new Size(6, 1);
        const backend = new MockTerminalBackend(size);
        const termScreen = new TerminalScreen(size);
        sep.localPosition = new Offset(0, 0);
        sep.layout(BoxConstraints.tight(size));
        sep.render(new RenderContext(termScreen));
        termScreen.flush(backend);

        expect(backend.getTextAt(new Point(0, 0), 6)).toBe("──────");
    });
});
