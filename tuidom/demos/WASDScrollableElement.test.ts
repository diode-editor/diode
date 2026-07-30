import { describe, expect, it } from "vitest";

import { TestApp } from "../../src/TestUtils/TestApp.ts";
import { Size } from "../common/geometryPromitives.ts";

import { WASDScrollableElement } from "./WASDScrollableElement.ts";

function createWASD(
    viewportWidth: number,
    viewportHeight: number,
    gridWidth: number,
    gridHeight: number,
): { widget: WASDScrollableElement; app: TestApp } {
    const widget = new WASDScrollableElement(gridWidth, gridHeight);
    widget.focusable = true;
    const app = TestApp.createWithContent(widget, new Size(viewportWidth, viewportHeight));
    widget.focus();
    return { widget, app };
}

describe("WASDScrollableElement", () => {
    it("starts at scroll position 0,0", () => {
        const { widget } = createWASD(10, 5, 40, 20);
        expect(widget.scrollTop).toBe(0);
        expect(widget.scrollLeft).toBe(0);
    });

    it("scrolls down with 's' key", () => {
        const { widget, app } = createWASD(10, 5, 40, 20);
        app.sendKey("s");
        expect(widget.scrollTop).toBe(1);
        expect(widget.scrollLeft).toBe(0);
    });

    it("scrolls up with 'w' key", () => {
        const { widget, app } = createWASD(10, 5, 40, 20);
        widget.scrollTo(0, 5);
        app.sendKey("w");
        expect(widget.scrollTop).toBe(4);
    });

    it("scrolls right with 'd' key", () => {
        const { widget, app } = createWASD(10, 5, 40, 20);
        app.sendKey("d");
        expect(widget.scrollLeft).toBe(1);
        expect(widget.scrollTop).toBe(0);
    });

    it("scrolls left with 'a' key", () => {
        const { widget, app } = createWASD(10, 5, 40, 20);
        widget.scrollTo(10, 0);
        app.sendKey("a");
        expect(widget.scrollLeft).toBe(9);
    });

    it("does not scroll above top boundary", () => {
        const { widget, app } = createWASD(10, 5, 40, 20);
        app.sendKey("w");
        expect(widget.scrollTop).toBe(0);
    });

    it("does not scroll past left boundary", () => {
        const { widget, app } = createWASD(10, 5, 40, 20);
        app.sendKey("a");
        expect(widget.scrollLeft).toBe(0);
    });

    it("does not scroll past bottom boundary", () => {
        const { widget, app } = createWASD(10, 5, 40, 20);
        widget.scrollTo(0, 15); // max = 20 - 5 = 15
        app.sendKey("s");
        expect(widget.scrollTop).toBe(15);
    });

    it("does not scroll past right boundary", () => {
        const { widget, app } = createWASD(10, 5, 40, 20);
        widget.scrollTo(30, 0); // max = 40 - 10 = 30
        app.sendKey("d");
        expect(widget.scrollLeft).toBe(30);
    });

    it("scrolls diagonally with multiple keys", () => {
        const { widget, app } = createWASD(10, 5, 40, 20);
        app.sendKey("s");
        app.sendKey("s");
        app.sendKey("d");
        app.sendKey("d");
        app.sendKey("d");
        expect(widget.scrollTop).toBe(2);
        expect(widget.scrollLeft).toBe(3);
    });

    it("renders without errors after scrolling", () => {
        const { app } = createWASD(10, 5, 40, 20);
        app.sendKey("s");
        app.sendKey("d");
        app.render();

        const output = app.backend.screenToString();
        expect(output.length).toBeGreaterThan(0);
    });
});
