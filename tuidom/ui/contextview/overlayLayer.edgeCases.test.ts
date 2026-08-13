import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../testing/TestApp.ts";
import { Point, Size } from "../../common/geometryPromitives.ts";
import { TUIKeyboardEvent } from "../../dom/events/tuiKeyboardEvent.ts";
import { InputElement } from "../inputbox/inputElement.ts";
import { PopupMenuElement } from "../menu/popupMenuElement.ts";

describe("OverlayLayer edge cases", () => {
    it("removeItem disposes an active session and detaches its listeners", () => {
        const input = new InputElement();
        const app = TestApp.createWithContent(input, new Size(30, 10));
        const layer = app.root.overlayLayer;

        const menu = new PopupMenuElement([{ label: "Copy" }]);
        menu.focusable = true;

        const onClose = vi.fn();
        const session = layer.createSession(menu, new Point(2, 2), {
            visible: true,
            closeOnEscape: true,
            pointerPolicy: "passthrough",
            onClose,
        });

        expect(session.isOpen()).toBe(true);
        expect(layer.getItems().length).toBe(1);

        // removeItem on an element that owns a live session must route through disposeSession.
        layer.removeItem(menu);

        expect(session.isDisposed).toBe(true);
        expect(layer.getItems().length).toBe(0);
        expect(layer.hasVisibleItems()).toBe(false);

        // Listeners were cleaned up: a root Escape no longer reaches the (gone) session,
        // and disposing does not fire onClose (only close() does).
        expect(onClose).not.toHaveBeenCalled();
        app.root.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Escape" }));
        expect(session.isOpen()).toBe(false);
    });

    it("handle.isDisposed reflects the live session state", () => {
        const input = new InputElement();
        const app = TestApp.createWithContent(input, new Size(30, 10));
        const layer = app.root.overlayLayer;

        const menu = new PopupMenuElement([{ label: "Cut" }]);
        const session = layer.createSession(menu, new Point(1, 1), { visible: false, pointerPolicy: "passthrough" });

        expect(session.isDisposed).toBe(false);
        session.dispose();
        expect(session.isDisposed).toBe(true);
    });

    it("handle.setAnchor repositions the menu using anchor-clamping logic", () => {
        const input = new InputElement();
        const app = TestApp.createWithContent(input, new Size(20, 6));
        const layer = app.root.overlayLayer;

        const menu = new PopupMenuElement([{ label: "Delete" }]);
        const session = layer.createSession(menu, new Point(0, 0), { visible: true, pointerPolicy: "passthrough" });

        const menuW = menu.getMaxIntrinsicWidth(0);
        const menuH = menu.getMaxIntrinsicHeight(menuW);

        // Anchor near the bottom-right corner forces both X-clamp and Y-flip.
        session.setAnchor({ screenX: 19, screenY: 5 });
        app.render();

        const item = layer.getItems().find((i) => i.element === menu);
        expect(item).toBeDefined();
        expect(item?.position.x).toBe(Math.max(0, 20 - menuW));
        expect(item?.position.y).toBe(Math.max(0, 5 - menuH));
    });

    it("setAnchor is a no-op after the session is disposed", () => {
        const input = new InputElement();
        const app = TestApp.createWithContent(input, new Size(20, 6));
        const layer = app.root.overlayLayer;

        const menu = new PopupMenuElement([{ label: "Delete" }]);
        const session = layer.createSession(menu, new Point(0, 0), { visible: false, pointerPolicy: "passthrough" });
        session.dispose();

        expect(() => {
            session.setAnchor({ screenX: 5, screenY: 5 });
        }).not.toThrow();
        // Nothing left to reposition.
        expect(layer.getItems().length).toBe(0);
    });

    it("clearAll cleans up listeners of open sessions so Escape no longer closes them", () => {
        const input = new InputElement();
        const app = TestApp.createWithContent(input, new Size(30, 10));
        const layer = app.root.overlayLayer;

        const menu = new PopupMenuElement([{ label: "Copy" }]);
        menu.focusable = true;

        const onClose = vi.fn();
        const session = layer.createSession(menu, new Point(3, 1), {
            visible: true,
            closeOnEscape: true,
            pointerPolicy: "passthrough",
            onClose,
        });

        expect(session.isOpen()).toBe(true);
        expect(layer.hasVisibleItems()).toBe(true);

        layer.clearAll();

        expect(layer.getItems().length).toBe(0);
        expect(layer.hasVisibleItems()).toBe(false);
        expect(session.isDisposed).toBe(true);
        // clearAll only flips isDisposed; it does not invoke onClose.
        expect(onClose).not.toHaveBeenCalled();

        // The escape listener was removed, so a root Escape does nothing.
        app.root.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Escape" }));
        expect(session.isOpen()).toBe(false);
    });

    it("createSession for an element with an existing session disposes the old one first", () => {
        const input = new InputElement();
        const app = TestApp.createWithContent(input, new Size(30, 10));
        const layer = app.root.overlayLayer;

        const menu = new PopupMenuElement([{ label: "Copy" }]);

        const first = layer.createSession(menu, new Point(1, 1), { visible: true, pointerPolicy: "passthrough" });
        expect(first.isOpen()).toBe(true);
        expect(layer.getItems().length).toBe(1);

        // Re-creating a session for the SAME element triggers disposeSessionByElement.
        const second = layer.createSession(menu, new Point(4, 4), { visible: false, pointerPolicy: "passthrough" });

        expect(first.isDisposed).toBe(true);
        expect(second.isDisposed).toBe(false);
        // Only the new session's item exists.
        expect(layer.getItems().length).toBe(1);
        expect(layer.hasVisibleItems()).toBe(false);

        const item = layer.getItems()[0];
        expect(item.position.x).toBe(4);
        expect(item.position.y).toBe(4);
    });
});
