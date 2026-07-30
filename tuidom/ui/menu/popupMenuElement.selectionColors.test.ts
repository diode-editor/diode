import { describe, expect, it } from "vitest";

import { MockTerminalBackend } from "../../backend/mockTerminalBackend.ts";
import { Point, Size } from "../../common/geometryPromitives.ts";
import { TuiApplication } from "../../dom/tuiApplication.ts";
import { TUIElement } from "../../dom/tuiElement.ts";
import { BodyElement } from "../body/bodyElement.ts";
import { VStackElement } from "../layout/vStackElement.ts";

import type { MenuBarItem } from "./menuBarElement.ts";
import { MenuBarElement } from "./menuBarElement.ts";
import { unthemedMenuStyles } from "./popupMenuItemElement.tsx";

class FocusableChild extends TUIElement {
    public constructor() {
        super();
        this.focusable = true;
    }

    public render(): void {
        // noop
    }
}

function setup(
    items: MenuBarItem[],
    width = 30,
    height = 15,
): {
    backend: MockTerminalBackend;
    app: TuiApplication;
    menuBar: MenuBarElement;
} {
    const backend = new MockTerminalBackend(new Size(width, height));
    const app = new TuiApplication(backend);

    const body = new BodyElement();
    const menuBar = new MenuBarElement(items);
    const stack = new VStackElement();
    const child = new FocusableChild();
    stack.addChild(child, { width: "fill", height: 3 });

    body.setMenuBar(menuBar);
    body.setContent(stack);
    app.root = body;
    app.run();

    return { backend, app, menuBar };
}

function simpleItems(): MenuBarItem[] {
    return [
        { label: "File", entries: [{ label: "New" }, { label: "Open" }, { label: "Save" }] },
        { label: "Edit", entries: [{ label: "Undo" }, { label: "Redo" }] },
    ];
}

describe("PopupMenuElement selection colors", () => {
    it("first item is highlighted when popup opens", () => {
        const { backend } = setup(simpleItems());
        backend.sendKey("Tab");
        backend.sendKey("ArrowDown");
        // Popup border at x=2 (top-left ╭), first item "New" at y=2, content column at x=3.
        expect(backend.getBgAt(new Point(3, 2))).toBe(unthemedMenuStyles.highlightBg);
    });

    it("first item has highlight foreground when popup opens", () => {
        const { backend } = setup(simpleItems());
        backend.sendKey("Tab");
        backend.sendKey("ArrowDown");
        expect(backend.getFgAt(new Point(3, 2))).toBe(unthemedMenuStyles.highlightFg);
    });

    it("ArrowDown moves highlight to second item", () => {
        const { backend } = setup(simpleItems());
        backend.sendKey("Tab");
        backend.sendKey("ArrowDown");
        backend.sendKey("ArrowDown");
        expect(backend.getBgAt(new Point(3, 2))).not.toBe(unthemedMenuStyles.highlightBg);
        expect(backend.getBgAt(new Point(3, 3))).toBe(unthemedMenuStyles.highlightBg);
    });
});
