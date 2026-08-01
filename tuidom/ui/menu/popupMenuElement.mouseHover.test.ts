import { describe, expect, it } from "vitest";

import { MockTerminalBackend } from "../../backend/mockTerminalBackend.ts";
import { Point, Size } from "../../common/geometryPromitives.ts";
import { STYLE_TOKEN_DEFAULTS } from "../../dom/styles/styleTokens.ts";
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

function setup(
    items: MenuBarItem[],
    width = 30,
    height = 15,
): { backend: MockTerminalBackend; menuBar: MenuBarElement } {
    const backend = new MockTerminalBackend(new Size(width, height));
    const app = new TuiApplication(backend);

    const body = new BodyElement();
    const menuBar = new MenuBarElement(items);
    const stack = new VStackElement();
    stack.addChild(new FocusableChild(), { width: "fill", height: 3 });

    body.setMenuBar(menuBar);
    body.setContent(stack);
    app.root = body;
    app.run();

    return { backend, menuBar };
}

function moveMouse(backend: MockTerminalBackend, x: number, y: number): void {
    backend.simulateMouse({
        kind: "mouse",
        button: "none",
        action: "move",
        x: x + 1,
        y: y + 1,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
    });
}

function items(): MenuBarItem[] {
    return [
        { label: "File", entries: [{ label: "New" }, { label: "Open" }, { label: "Save" }] },
        { label: "Edit", entries: [{ label: "Undo" }, { label: "Redo" }] },
    ];
}

describe("PopupMenuElement — mouse hover moves selection", () => {
    // Popup opens under "File": border row y=1, items "New"/"Open"/"Save" at y=2/3/4.
    // Menu bar has a 2-col leading spacer, so popup content sits at x=3.
    it("hovering a menu item highlights it", () => {
        const { backend } = setup(items());
        backend.sendKey("Tab");
        backend.sendKey("ArrowDown"); // open File menu, first item highlighted

        expect(backend.getBgAt(new Point(3, 2))).toBe(STYLE_TOKEN_DEFAULTS["menu.selectionBackground"]);

        moveMouse(backend, 4, 4); // over "Save"
        expect(backend.getBgAt(new Point(3, 4))).toBe(STYLE_TOKEN_DEFAULTS["menu.selectionBackground"]);
        expect(backend.getBgAt(new Point(3, 2))).not.toBe(STYLE_TOKEN_DEFAULTS["menu.selectionBackground"]);
    });

    it("hovering the already-selected item keeps it highlighted", () => {
        const { backend } = setup(items());
        backend.sendKey("Tab");
        backend.sendKey("ArrowDown"); // "New" (first item) selected

        moveMouse(backend, 4, 2); // hover "New" — already selected
        expect(backend.getBgAt(new Point(3, 2))).toBe(STYLE_TOKEN_DEFAULTS["menu.selectionBackground"]);
    });

    it("hovering back up moves the highlight up again", () => {
        const { backend } = setup(items());
        backend.sendKey("Tab");
        backend.sendKey("ArrowDown");

        moveMouse(backend, 4, 4); // "Save"
        expect(backend.getBgAt(new Point(3, 4))).toBe(STYLE_TOKEN_DEFAULTS["menu.selectionBackground"]);

        moveMouse(backend, 4, 3); // "Open"
        expect(backend.getBgAt(new Point(3, 3))).toBe(STYLE_TOKEN_DEFAULTS["menu.selectionBackground"]);
        expect(backend.getBgAt(new Point(3, 4))).not.toBe(STYLE_TOKEN_DEFAULTS["menu.selectionBackground"]);
    });

    it("Enter activates the mouse-hovered item", () => {
        let activated: string | null = null;
        const menuItems: MenuBarItem[] = [
            {
                label: "File",
                entries: [
                    { label: "New", onSelect: () => (activated = "New") },
                    { label: "Open", onSelect: () => (activated = "Open") },
                    { label: "Save", onSelect: () => (activated = "Save") },
                ],
            },
        ];
        const { backend } = setup(menuItems);
        backend.sendKey("Tab");
        backend.sendKey("ArrowDown");

        moveMouse(backend, 4, 4); // hover "Save"
        backend.sendKey("Enter");

        expect(activated).toBe("Save");
    });
});

describe("MenuBarElement — hovering another top item switches the open menu", () => {
    it("switches from File to Edit on hover while a menu is open", () => {
        const { backend, menuBar } = setup(items());
        backend.sendKey("Tab");
        backend.sendKey("ArrowDown"); // File menu open
        expect(menuBar.activeIndex).toBe(0);

        // "File" at x=2, "Edit" right after it (" File " = 6 cols → x=8..).
        moveMouse(backend, 9, 0); // hover "Edit" in the menu bar
        expect(menuBar.activeIndex).toBe(1);
        expect(menuBar.isMenuOpen).toBe(true);
    });

    it("does not open a menu on hover when none is open yet", () => {
        const { backend, menuBar } = setup(items());
        backend.sendKey("Tab"); // menu bar focused, but no dropdown open
        expect(menuBar.isMenuOpen).toBe(false);

        moveMouse(backend, 9, 0); // hover "Edit"
        expect(menuBar.isMenuOpen).toBe(false);
    });
});
