import { describe, expect, it } from "vitest";

import { MockTerminalBackend } from "../../backend/mockTerminalBackend.ts";
import { Size } from "../../common/geometryPromitives.ts";
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

function simpleItems(): MenuBarItem[] {
    return [
        { label: "File", entries: [{ label: "New" }] },
        { label: "Edit", entries: [{ label: "Undo" }] },
    ];
}

describe("MenuBarElement — intrinsic sizing", () => {
    it("is always exactly one row tall regardless of width", () => {
        const bar = new MenuBarElement(simpleItems());
        expect(bar.getMinIntrinsicHeight(0)).toBe(1);
        expect(bar.getMinIntrinsicHeight(100)).toBe(1);
        expect(bar.getMaxIntrinsicHeight(0)).toBe(1);
        expect(bar.getMaxIntrinsicHeight(100)).toBe(1);
    });

    it("derives its intrinsic width from the inner item layout", () => {
        const bar = new MenuBarElement(simpleItems());

        const minWidth = bar.getMinIntrinsicWidth(1);
        const maxWidth = bar.getMaxIntrinsicWidth(1);

        // The bar contains a 1-cell leading spacer plus the " File " and " Edit "
        // items, so its width comfortably accommodates both padded labels.
        expect(minWidth).toBeGreaterThanOrEqual(" File ".length + " Edit ".length);
        expect(maxWidth).toBeGreaterThanOrEqual(minWidth);
    });
});

describe("MenuBarElement — openMenu index guard", () => {
    it("ignores activation when the active index is out of range (empty bar)", () => {
        const backend = new MockTerminalBackend(new Size(20, 8));
        const app = new TuiApplication(backend);

        const body = new BodyElement();
        const menuBar = new MenuBarElement([]);
        const stack = new VStackElement();
        stack.addChild(new FocusableChild(), { width: "fill", height: 3 });

        body.setMenuBar(menuBar);
        body.setContent(stack);
        app.root = body;
        app.run();

        backend.sendKey("Tab"); // focusing an empty bar sets activeIndex to 0
        expect(menuBar.activeIndex).toBe(0);

        // Enter calls openMenu(0); with no items, index 0 is out of range and is ignored.
        backend.sendKey("Enter");
        expect(menuBar.isMenuOpen).toBe(false);
        expect(menuBar.activeIndex).toBe(0);
    });
});
