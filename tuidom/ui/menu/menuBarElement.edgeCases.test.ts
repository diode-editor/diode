import { describe, expect, it } from "vitest";

import { MockTerminalBackend } from "../../backend/mockTerminalBackend.ts";
import { Size } from "../../common/geometryPromitives.ts";
import { TUIKeyboardEvent } from "../../dom/events/tuiKeyboardEvent.ts";
import { TuiApplication } from "../../dom/tuiApplication.ts";
import { TUIElement } from "../../dom/tuiElement.ts";
import { BodyElement } from "../body/bodyElement.ts";
import { VStackElement } from "../layout/vStackElement.ts";

import type { MenuBarItem } from "./menuBarElement.ts";
import { MenuBarElement } from "./menuBarElement.ts";

class FocusableChild extends TUIElement {
    public constructor() {
        super();
        this.tabIndex = 0;
    }

    public render(): void {
        // noop
    }
}

function simpleItems(): MenuBarItem[] {
    return [
        { label: "File", entries: [{ label: "New" }, { label: "Open" }, { label: "Save" }] },
        { label: "Edit", entries: [{ label: "Undo" }, { label: "Redo" }] },
        { label: "View", entries: [{ label: "Zoom In" }, { label: "Zoom Out" }] },
    ];
}

function setupWithBody(
    items: MenuBarItem[],
    childCount = 2,
    width = 30,
    height = 15,
): {
    backend: MockTerminalBackend;
    app: TuiApplication;
    menuBar: MenuBarElement;
    children: FocusableChild[];
    body: BodyElement;
} {
    const backend = new MockTerminalBackend(new Size(width, height));
    const app = new TuiApplication(backend);

    const body = new BodyElement();
    const menuBar = new MenuBarElement(items);
    const stack = new VStackElement();

    const children: FocusableChild[] = [];
    for (let i = 0; i < childCount; i++) {
        const child = new FocusableChild();
        stack.addChild(child, { width: "fill", height: 3 });
        children.push(child);
    }

    body.setMenuBar(menuBar);
    body.setContent(stack);
    app.root = body;
    app.run();

    return { backend, app, menuBar, children, body };
}

describe("MenuBarElement — setParent mnemonic listener lifecycle", () => {
    it("installs a parent keydown listener so a child's Alt+mnemonic opens a menu while attached", () => {
        const { backend, menuBar, children } = setupWithBody(simpleItems());

        backend.sendKey("Tab"); // menuBar
        backend.sendKey("Tab"); // child[0]
        expect(children[0].isFocused).toBe(true);

        backend.sendKey("Alt+f"); // intercepted by the parent-installed listener
        expect(menuBar.isMenuOpen).toBe(true);
        expect(menuBar.activeIndex).toBe(0);
    });

    it("removes the parent listener on detach so the mnemonic no longer opens a menu", () => {
        const { backend, menuBar, children, body } = setupWithBody(simpleItems());

        backend.sendKey("Tab"); // menuBar
        backend.sendKey("Tab"); // child[0]
        expect(children[0].isFocused).toBe(true);

        body.setMenuBar(null); // removes the keydown listener from body

        // Dispatch the mnemonic straight at the still-attached child / parent: no effect.
        children[0].dispatchEvent(new TUIKeyboardEvent("keydown", { key: "f", altKey: true }));
        expect(menuBar.isMenuOpen).toBe(false);
        expect(menuBar.activeIndex).toBe(-1);

        // Sanity: body still holds the reference but listener is gone.
        body.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "f", altKey: true }));
        expect(menuBar.isMenuOpen).toBe(false);
    });

    it("re-parenting removes the old listener and installs a fresh one on the new root", () => {
        const { menuBar, children, body } = setupWithBody(simpleItems());
        expect(menuBar.getRoot()).toBe(body);

        // Move the menuBar to a brand-new body (exercises the remove-old + add-new path).
        const newBody = new BodyElement();
        newBody.setMenuBar(menuBar);
        expect(menuBar.getRoot()).toBe(newBody);

        // The old root no longer routes the mnemonic.
        body.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "f", altKey: true }));
        expect(menuBar.isMenuOpen).toBe(false);

        // The old child is unaffected too.
        children[0].dispatchEvent(new TUIKeyboardEvent("keydown", { key: "f", altKey: true }));
        expect(menuBar.isMenuOpen).toBe(false);

        // The new root does route it.
        newBody.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "f", altKey: true }));
        expect(menuBar.isMenuOpen).toBe(true);
    });

    it("falls back to the parent when the subtree is not attached to a root yet", () => {
        const detached = new TUIElement();
        const menuBar = new MenuBarElement(simpleItems());
        detached.appendChild(menuBar);
        expect(menuBar.getRoot()).toBeNull();

        // The mnemonic listener sits on the parent — events bubbling to it open the menu.
        detached.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "f", altKey: true }));
        expect(menuBar.isMenuOpen).toBe(true);
    });
});

describe("MenuBarElement — keyboard forwarding while a popup is open", () => {
    it("ArrowUp with a popup open keeps the popup open and the bar highlight unchanged", () => {
        const { backend, menuBar } = setupWithBody(simpleItems());

        backend.sendKey("Alt+f"); // open File popup
        expect(menuBar.isMenuOpen).toBe(true);
        expect(menuBar.activeIndex).toBe(0);

        backend.sendKey("ArrowUp"); // forwarded to popup, bar stays put
        expect(menuBar.isMenuOpen).toBe(true);
        expect(menuBar.activeIndex).toBe(0);
    });

    it("an unrelated key with a popup open is forwarded without closing the popup", () => {
        const { backend, menuBar } = setupWithBody(simpleItems());

        backend.sendKey("Alt+f"); // open File popup
        expect(menuBar.isMenuOpen).toBe(true);

        backend.sendKey("x"); // generic passthrough branch → forwardToPopup
        expect(menuBar.isMenuOpen).toBe(true);
        expect(menuBar.activeIndex).toBe(0);
    });
});

describe("MenuBarElement — open/close state transitions via the overlay session", () => {
    it("closing the popup through its own onClose clears the menu's open state", () => {
        const { backend, menuBar, body } = setupWithBody(simpleItems());

        backend.sendKey("Alt+f"); // open File popup
        expect(menuBar.isMenuOpen).toBe(true);

        // The popup lives in the context-menu layer; close it via its own Escape handler,
        // which routes popup.onClose → session.close() → the session onClose callback.
        const popup = body.overlayLayer.getItems()[0].element;
        popup.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Escape" }));

        expect(menuBar.isMenuOpen).toBe(false);
    });

    it("opening a different menu disposes the previous popup and tracks the new index", () => {
        const { backend, menuBar, body } = setupWithBody(simpleItems());

        backend.sendKey("Alt+f"); // File
        expect(menuBar.activeIndex).toBe(0);
        expect(body.overlayLayer.getItems().length).toBe(1);

        backend.sendKey("ArrowRight"); // switch to Edit popup
        expect(menuBar.activeIndex).toBe(1);
        expect(menuBar.isMenuOpen).toBe(true);
        // Exactly one popup remains — the previous one was disposed, not stacked.
        expect(body.overlayLayer.getItems().length).toBe(1);
    });
});

describe("MenuBarElement — wrapIndex with no items", () => {
    it("arrow navigation on an empty menu bar leaves activeIndex at the no-selection sentinel", () => {
        const { backend, menuBar } = setupWithBody([], 1);

        backend.sendKey("Tab"); // focusing an empty bar sets activeIndex to 0
        expect(menuBar.activeIndex).toBe(0);

        backend.sendKey("ArrowRight"); // wrapIndex returns -1 for an empty bar
        expect(menuBar.activeIndex).toBe(-1);
        expect(menuBar.isMenuOpen).toBe(false);
    });
});
