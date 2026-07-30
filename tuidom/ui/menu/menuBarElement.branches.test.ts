import { describe, expect, it } from "vitest";

import { MockTerminalBackend } from "../../backend/mockTerminalBackend.ts";
import { Size } from "../../common/geometryPromitives.ts";
import { TUIFocusEvent } from "../../dom/events/tuiFocusEvent.ts";
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
        this.focusable = true;
    }

    public render(): void {
        // noop
    }
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

function simpleItems(): MenuBarItem[] {
    return [
        { label: "File", entries: [{ label: "New" }, { label: "Open" }, { label: "Save" }] },
        { label: "Edit", entries: [{ label: "Undo" }, { label: "Redo" }] },
    ];
}

describe("MenuBarElement — focus when an item is already active", () => {
    it("keeps the current highlight when a fresh focus event arrives with activeIndex >= 0", () => {
        const { backend, menuBar } = setupWithBody(simpleItems());

        backend.sendKey("Tab"); // focus → activeIndex becomes 0
        backend.sendKey("ArrowRight"); // move highlight to 1
        expect(menuBar.activeIndex).toBe(1);

        // A re-focus while an item is already active must not reset the highlight to 0.
        menuBar.dispatchEvent(new TUIFocusEvent("focus", null));
        expect(menuBar.activeIndex).toBe(1);
    });
});

describe("MenuBarElement — ArrowUp without an open popup", () => {
    it("does nothing on ArrowUp when no popup is open", () => {
        const { backend, menuBar } = setupWithBody(simpleItems());

        backend.sendKey("Tab"); // focus, activeIndex 0, no popup
        expect(menuBar.isMenuOpen).toBe(false);

        backend.sendKey("ArrowUp"); // activeMenu is null → no-op
        expect(menuBar.isMenuOpen).toBe(false);
        expect(menuBar.activeIndex).toBe(0);
    });
});

describe("MenuBarElement — separator entries", () => {
    it("opens a menu whose entries include a separator", () => {
        const items: MenuBarItem[] = [
            { label: "File", entries: [{ label: "New" }, { type: "separator" }, { label: "Exit" }] },
        ];
        const { backend, menuBar, body } = setupWithBody(items, 0, 20, 10);

        backend.sendKey("Alt+f");

        expect(menuBar.isMenuOpen).toBe(true);
        // The popup rendered with the separator entry passed through openMenu's mapping.
        expect(body.overlayLayer.getItems().length).toBe(1);
    });
});

describe("MenuBarElement — empty-label mnemonic fallback", () => {
    it("does not match an Alt key against an item with an empty label and no mnemonic", () => {
        // label="" and no mnemonic → the mnemonic resolves to "" via the final `?? ""`,
        // so no Alt key can match it.
        const items: MenuBarItem[] = [{ label: "", entries: [{ label: "Only" }] }];
        const { backend, menuBar } = setupWithBody(items, 1, 20, 10);

        backend.sendKey("Alt+a");
        expect(menuBar.activeIndex).toBe(-1);
        expect(menuBar.isMenuOpen).toBe(false);
    });
});

describe("MenuBarElement — keydown ignored when nothing is active", () => {
    it("Escape with activeIndex < 0 is a no-op", () => {
        const { menuBar } = setupWithBody(simpleItems());

        // Not focused, activeIndex still -1 → handleKeydownDefault returns immediately.
        menuBar.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Escape" }));
        expect(menuBar.activeIndex).toBe(-1);
        expect(menuBar.isMenuOpen).toBe(false);
    });
});
