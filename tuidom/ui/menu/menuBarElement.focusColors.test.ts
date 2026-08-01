import { describe, expect, it } from "vitest";

import { MockTerminalBackend } from "../../backend/mockTerminalBackend.ts";
import { packRgb } from "../../common/colorUtils.ts";
import { Point, Size } from "../../common/geometryPromitives.ts";
import { STYLE_TOKEN_DEFAULTS } from "../../dom/styles/styleTokens.ts";
import { TuiApplication } from "../../dom/tuiApplication.ts";
import { TUIElement } from "../../dom/tuiElement.ts";
import { BodyElement } from "../body/bodyElement.ts";
import { VStackElement } from "../layout/vStackElement.ts";

import type { MenuBarItem } from "./menuBarElement.ts";
import { MenuBarElement } from "./menuBarElement.ts";

const MENU_BAR_FG = STYLE_TOKEN_DEFAULTS["menuBar.foreground"];
const MENU_BAR_BG = STYLE_TOKEN_DEFAULTS["menuBar.background"];
const ACTIVE_MENU_FG = STYLE_TOKEN_DEFAULTS["menubar.selectionForeground"];
const ACTIVE_MENU_BG = STYLE_TOKEN_DEFAULTS["menubar.selectionBackground"];

class FocusableChild extends TUIElement {
    public constructor() {
        super();
        this.focusable = true;
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

describe("MenuBarElement focus colors", () => {
    // " File " occupies positions x=1..6 on y=0 (x=0 is the 1-char spacer)
    // " Edit " occupies positions x=7..12 on y=0
    // " View " occupies positions x=13..18 on y=0

    it("unfocused menu items have bar background color", () => {
        const { backend } = setup(simpleItems());

        // All items should have MENU_BAR_BG
        for (let x = 0; x < 18; x++) {
            expect(backend.getBgAt(new Point(x, 0))).toBe(MENU_BAR_BG);
        }
    });

    it("unfocused menu items have bar foreground color", () => {
        const { backend } = setup(simpleItems());

        for (let x = 0; x < 18; x++) {
            expect(backend.getFgAt(new Point(x, 0))).toBe(MENU_BAR_FG);
        }
    });

    it("focused menu item has active background color", () => {
        const { backend } = setup(simpleItems());

        backend.sendKey("Tab"); // focus menuBar → activeIndex=0 ("File")

        // " File " positions should have ACTIVE_MENU_BG (starts at x=2 due to spacer)
        for (let x = 2; x < 8; x++) {
            expect(backend.getBgAt(new Point(x, 0))).toBe(ACTIVE_MENU_BG);
        }
    });

    it("focused menu item has active foreground color", () => {
        const { backend } = setup(simpleItems());

        backend.sendKey("Tab");

        for (let x = 2; x < 8; x++) {
            expect(backend.getFgAt(new Point(x, 0))).toBe(ACTIVE_MENU_FG);
        }
    });

    it("non-active items keep bar colors when menuBar is focused", () => {
        const { backend } = setup(simpleItems());

        backend.sendKey("Tab"); // focus → "File" active

        // " Edit " at x=8..13 should keep bar colors
        for (let x = 8; x < 14; x++) {
            expect(backend.getBgAt(new Point(x, 0))).toBe(MENU_BAR_BG);
        }
    });

    it("ArrowRight moves active highlight to next item", () => {
        const { backend } = setup(simpleItems());

        backend.sendKey("Tab"); // focus → "File"
        backend.sendKey("ArrowRight"); // → "Edit"

        // " File " should revert to bar colors
        for (let x = 2; x < 8; x++) {
            expect(backend.getBgAt(new Point(x, 0))).toBe(MENU_BAR_BG);
        }

        // " Edit " should have active colors
        for (let x = 8; x < 14; x++) {
            expect(backend.getBgAt(new Point(x, 0))).toBe(ACTIVE_MENU_BG);
        }
    });

    it("blur resets all items to bar colors", () => {
        const { backend } = setup(simpleItems());

        backend.sendKey("Tab"); // focus menuBar
        backend.sendKey("Tab"); // blur menuBar (focus child)

        // All items should revert to MENU_BAR_BG
        for (let x = 0; x < 18; x++) {
            expect(backend.getBgAt(new Point(x, 0))).toBe(MENU_BAR_BG);
        }
    });
});

describe("MenuBarElement menu styles", () => {
    const customBg = packRgb(0x12, 0x34, 0x56);

    it("дропдаун, открытый позже, резолвит цвета из var-scope корня", () => {
        const { backend, app, menuBar } = setup(simpleItems());
        void menuBar;
        app.root?.setStyleVars({ "menu.background": customBg });
        backend.sendKey("Tab"); // focus menuBar → "File"
        backend.sendKey("Enter"); // open dropdown

        // Top-left corner of the dropdown frame (x=2: "File" starts after the 2-cell spacer).
        expect(backend.getBgAt(new Point(2, 1))).toBe(customBg);
    });

    it("смена корневой таблицы перекрашивает уже открытый дропдаун", () => {
        const { backend, app } = setup(simpleItems());

        backend.sendKey("Tab");
        backend.sendKey("Enter"); // open dropdown с дефолтами токенов
        expect(backend.getBgAt(new Point(2, 1))).toBe(STYLE_TOKEN_DEFAULTS["menu.background"]);

        app.root?.setStyleVars({ "menu.background": customBg });
        backend.sendKey("x"); // inert for the open menu; forces a synchronous re-render

        expect(backend.getBgAt(new Point(2, 1))).toBe(customBg);
    });
});
