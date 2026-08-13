import { describe, expect, it } from "vitest";

import { TestApp } from "../../testing/TestApp.ts";
import { Point, Size } from "../../common/geometryPromitives.ts";
import { TUIKeyboardEvent } from "../../dom/events/tuiKeyboardEvent.ts";
import { TUIMouseEvent } from "../../dom/events/tuiMouseEvent.ts";
import { InputElement } from "../inputbox/inputElement.ts";
import { BoxElement } from "../layout/boxElement.ts";

// Renders the body so the overlay's corner glyph ("+") can be located on screen.
function cornerCells(app: TestApp): { x: number; y: number }[] {
    const screen = app.backend.screenToString().split("\n");
    const found: { x: number; y: number }[] = [];
    for (let y = 0; y < screen.length; y++) {
        for (let x = 0; x < screen[y].length; x++) {
            if (screen[y][x] === "+") found.push({ x, y });
        }
    }
    return found;
}

describe("OverlayLayer — open at point and dismiss", () => {
    it("renders a session overlay at the requested screen point", () => {
        const app = TestApp.createWithContent(new InputElement(), new Size(30, 12));
        const layer = app.root.overlayLayer;

        const box = new BoxElement();
        layer.createSession(box, new Point(6, 3), { visible: true, pointerPolicy: "passthrough" });
        app.render();

        const corners = cornerCells(app);
        // The box's top-left "+" corner appears exactly at the session position.
        expect(corners).toContainEqual({ x: 6, y: 3 });
    });

    it("removes the overlay from the screen after the session closes", () => {
        const app = TestApp.createWithContent(new InputElement(), new Size(30, 12));
        const layer = app.root.overlayLayer;

        const box = new BoxElement();
        const session = layer.createSession(box, new Point(4, 2), { visible: true, pointerPolicy: "passthrough" });
        app.render();
        expect(cornerCells(app).length).toBeGreaterThan(0);

        session.close();
        app.render();

        // Closed → nothing drawn.
        expect(cornerCells(app)).toEqual([]);
        expect(layer.hasVisibleItems()).toBe(false);
    });

    it("dismisses an open session when Escape reaches the root (closeOnEscape)", () => {
        const app = TestApp.createWithContent(new InputElement(), new Size(30, 12));
        const layer = app.root.overlayLayer;

        const box = new BoxElement();
        const session = layer.createSession(box, new Point(5, 5), {
            visible: true,
            closeOnEscape: true,
            pointerPolicy: "passthrough",
        });

        expect(session.isOpen()).toBe(true);

        app.root.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Escape" }));

        expect(session.isOpen()).toBe(false);
        expect(layer.hasVisibleItems()).toBe(false);
    });

    it("dismisses an open session on an outside pointer press (closeOnOutsidePointer)", () => {
        const app = TestApp.createWithContent(new InputElement(), new Size(30, 12));
        const layer = app.root.overlayLayer;

        const box = new BoxElement();
        const session = layer.createSession(box, new Point(5, 5), {
            visible: true,
            pointerPolicy: "close-on-outside",
        });

        expect(session.isOpen()).toBe(true);

        // A mousedown whose target is the body (outside the overlay element) closes it.
        const event = new TUIMouseEvent("mousedown", {
            screenX: 0,
            screenY: 0,
            localX: 0,
            localY: 0,
            button: "left",
        });
        app.root.dispatchEvent(event);

        expect(session.isOpen()).toBe(false);
    });

    it("keeps the session open when Escape is not requested to close it", () => {
        const app = TestApp.createWithContent(new InputElement(), new Size(30, 12));
        const layer = app.root.overlayLayer;

        const box = new BoxElement();
        const session = layer.createSession(box, new Point(5, 5), {
            visible: true,
            closeOnEscape: false,
            pointerPolicy: "passthrough",
        });

        app.root.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Escape" }));

        // No closeOnEscape handler attached → still open.
        expect(session.isOpen()).toBe(true);
    });
});
