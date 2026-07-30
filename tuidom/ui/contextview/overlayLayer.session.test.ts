import { describe, expect, it } from "vitest";

import { TestApp } from "../../../src/TestUtils/TestApp.ts";
import { Point, Size } from "../../common/geometryPromitives.ts";
import { TUIKeyboardEvent } from "../../dom/events/tuiKeyboardEvent.ts";
import { TUIMouseEvent } from "../../dom/events/tuiMouseEvent.ts";
import { InputElement } from "../inputbox/inputElement.ts";
import { PopupMenuElement } from "../menu/popupMenuElement.ts";

describe("OverlayLayer session API", () => {
    it("open/close/dispose are idempotent", () => {
        const input = new InputElement();
        const app = TestApp.createWithContent(input, new Size(30, 10));

        const menu = new PopupMenuElement([{ label: "Copy" }]);
        const session = app.root.overlayLayer.createSession(menu, new Point(2, 2), {
            visible: false,
            pointerPolicy: "passthrough",
        });

        expect(() => {
            session.open();
            session.open();
            session.close();
            session.close();
            session.dispose();
            session.dispose();
        }).not.toThrow();

        expect(app.root.overlayLayer.getItems().length).toBe(0);
        expect(app.root.overlayLayer.hasVisibleItems()).toBe(false);
    });

    it("restores focus on close when restoreFocus=true", () => {
        const input = new InputElement();
        const app = TestApp.createWithContent(input, new Size(30, 10));

        input.focus();
        expect(app.focusedElement).toBe(input);

        const menu = new PopupMenuElement([{ label: "Copy" }]);
        menu.focusable = true;

        const session = app.root.overlayLayer.createSession(menu, new Point(1, 1), {
            visible: false,
            restoreFocus: true,
            focusOnOpen: true,
            pointerPolicy: "passthrough",
        });

        session.open();
        expect(app.focusedElement).toBe(menu);

        session.close();
        expect(app.focusedElement).toBe(input);
    });

    it("closes on outside click when closeOnOutsidePointer=true", () => {
        const input = new InputElement();
        const app = TestApp.createWithContent(input, new Size(30, 10));

        const menu = new PopupMenuElement([{ label: "Copy" }]);
        menu.focusable = true;

        const session = app.root.overlayLayer.createSession(menu, new Point(5, 2), {
            visible: true,
            pointerPolicy: "close-on-outside",
            focusOnOpen: true,
        });

        expect(app.root.overlayLayer.hasVisibleItems()).toBe(true);

        input.dispatchEvent(
            new TUIMouseEvent("mousedown", {
                button: "left",
                screenX: 0,
                screenY: 0,
                localX: 0,
                localY: 0,
            }),
        );

        expect(session.isOpen()).toBe(false);
        expect(app.root.overlayLayer.hasVisibleItems()).toBe(false);
    });

    it("closes on Escape when closeOnEscape=true", () => {
        const input = new InputElement();
        const app = TestApp.createWithContent(input, new Size(30, 10));

        const menu = new PopupMenuElement([{ label: "Copy" }]);
        menu.focusable = true;

        const session = app.root.overlayLayer.createSession(menu, new Point(3, 1), {
            visible: true,
            closeOnEscape: true,
            focusOnOpen: true,
            pointerPolicy: "passthrough",
        });

        expect(session.isOpen()).toBe(true);

        menu.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Escape" }));

        expect(session.isOpen()).toBe(false);
        expect(app.root.overlayLayer.hasVisibleItems()).toBe(false);
    });

    it("computeAnchorPosition clamps X and flips Y", () => {
        const input = new InputElement();
        const app = TestApp.createWithContent(input, new Size(20, 6));

        const menu = new PopupMenuElement([{ label: "Delete" }]);
        const menuW = menu.getMaxIntrinsicWidth(0);
        const menuH = menu.getMaxIntrinsicHeight(menuW);

        const position = app.root.overlayLayer.computeAnchorPosition(menu, {
            screenX: 19,
            screenY: 5,
        });

        expect(position.x).toBe(Math.max(0, 20 - menuW));
        expect(position.y).toBe(Math.max(0, 5 - menuH));
    });
});

describe("OverlayLayer — hasKeyboardCapturingOverlay", () => {
    function makeApp() {
        const input = new InputElement();
        const app = TestApp.createWithContent(input, new Size(30, 10));
        const menu = new PopupMenuElement([{ label: "Copy" }]);
        return { app, menu };
    }

    it("modal session captures the keyboard while visible, releases on close", () => {
        const { app, menu } = makeApp();
        const session = app.root.overlayLayer.createSession(menu, new Point(2, 2), {
            visible: true,
            pointerPolicy: "modal",
        });

        expect(app.root.overlayLayer.hasKeyboardCapturingOverlay()).toBe(true);

        session.close();
        expect(app.root.overlayLayer.hasKeyboardCapturingOverlay()).toBe(false);
    });

    it("close-on-outside session captures the keyboard (quickpick / context menus)", () => {
        const { app, menu } = makeApp();
        app.root.overlayLayer.createSession(menu, new Point(2, 2), {
            visible: true,
            pointerPolicy: "close-on-outside",
        });

        expect(app.root.overlayLayer.hasKeyboardCapturingOverlay()).toBe(true);
    });

    it("passthrough session does NOT capture (Find stays transparent)", () => {
        const { app, menu } = makeApp();
        app.root.overlayLayer.createSession(menu, new Point(2, 2), {
            visible: true,
            pointerPolicy: "passthrough",
        });

        expect(app.root.overlayLayer.hasKeyboardCapturingOverlay()).toBe(false);
    });

    it("passthrough + capturesKeyboard override captures (menu-bar dropdown config)", () => {
        const { app, menu } = makeApp();
        app.root.overlayLayer.createSession(menu, new Point(2, 2), {
            visible: true,
            pointerPolicy: "passthrough",
            capturesKeyboard: true,
        });

        expect(app.root.overlayLayer.hasKeyboardCapturingOverlay()).toBe(true);
    });

    it("capturesKeyboard:false override opts a modal out", () => {
        const { app, menu } = makeApp();
        app.root.overlayLayer.createSession(menu, new Point(2, 2), {
            visible: true,
            pointerPolicy: "modal",
            capturesKeyboard: false,
        });

        expect(app.root.overlayLayer.hasKeyboardCapturingOverlay()).toBe(false);
    });

    it("a hidden capturing session does not capture until opened", () => {
        const { app, menu } = makeApp();
        const session = app.root.overlayLayer.createSession(menu, new Point(2, 2), {
            visible: false,
            pointerPolicy: "modal",
        });

        expect(app.root.overlayLayer.hasKeyboardCapturingOverlay()).toBe(false);

        session.open();
        expect(app.root.overlayLayer.hasKeyboardCapturingOverlay()).toBe(true);
    });
});
