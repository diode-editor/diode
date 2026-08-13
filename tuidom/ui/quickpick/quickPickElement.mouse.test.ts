import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../testing/TestApp.ts";
import { Size } from "../../common/geometryPromitives.ts";
import { TUIMouseEvent } from "../../dom/events/tuiMouseEvent.ts";

import type { QuickPickItem } from "./quickPickElement.ts";
import { QuickPickElement } from "./quickPickElement.ts";

// ─── Test helpers ────────────────────────────────────────────────────────────

function createApp(picker: QuickPickElement, size: Size = new Size(40, 14)): TestApp {
    const app = TestApp.createWithContent(picker, size);
    picker.focus();
    return app;
}

function makeItems(count: number, prefix = "item-"): QuickPickItem[] {
    return Array.from({ length: count }, (_, i) => ({ label: `${prefix}${i + 1}` }));
}

/**
 * Dispatch a mouse event straight at the picker with a y offset local to it.
 * Row layout (no message row): border=0, input=1, separator=2, first item=3.
 */
function mouse(
    picker: QuickPickElement,
    type: "mousemove" | "click",
    localY: number,
    button: "left" | "none" = "none",
): void {
    picker.dispatchEvent(new TUIMouseEvent(type, { button, screenX: 0, screenY: localY, localX: 5, localY }));
}

// ─── Hover moves selection ────────────────────────────────────────────────────

describe("QuickPickElement — mouse hover moves selection", () => {
    it("hovering a list row moves the selection onto it", () => {
        const picker = new QuickPickElement();
        picker.items = makeItems(5);
        createApp(picker);

        expect(picker.selectedIndex).toBe(0);
        mouse(picker, "mousemove", 5); // separator=2, first item=3 → row 2 = index 2
        expect(picker.selectedIndex).toBe(2);
    });

    it("hovering the first item row selects index 0", () => {
        const picker = new QuickPickElement();
        picker.items = makeItems(5);
        createApp(picker);

        picker.dispatchEvent(
            new TUIMouseEvent("mousemove", { button: "none", screenX: 0, screenY: 0, localX: 5, localY: 3 }),
        );
        expect(picker.selectedIndex).toBe(0);
    });

    it("re-hovering the already-selected row is a no-op", () => {
        const picker = new QuickPickElement();
        picker.items = makeItems(5);
        createApp(picker);

        mouse(picker, "mousemove", 4); // index 1
        expect(picker.selectedIndex).toBe(1);
        mouse(picker, "mousemove", 4); // same row again
        expect(picker.selectedIndex).toBe(1);
    });

    it("hovering the input / border rows does not change selection", () => {
        const picker = new QuickPickElement();
        picker.items = makeItems(5);
        createApp(picker);

        mouse(picker, "mousemove", 4); // move to index 1 first
        expect(picker.selectedIndex).toBe(1);

        mouse(picker, "mousemove", 1); // input row — outside the list
        expect(picker.selectedIndex).toBe(1);
        mouse(picker, "mousemove", 0); // top border
        expect(picker.selectedIndex).toBe(1);
    });

    it("hovering below the last visible row does not change selection", () => {
        const picker = new QuickPickElement();
        picker.items = makeItems(3);
        createApp(picker);

        mouse(picker, "mousemove", 100);
        expect(picker.selectedIndex).toBe(0);
    });

    it("ignores other mouse events (mousedown) without changing selection", () => {
        const picker = new QuickPickElement();
        picker.items = makeItems(5);
        createApp(picker);

        mouse(picker, "mousemove", 4); // index 1
        picker.dispatchEvent(
            new TUIMouseEvent("mousedown", { button: "left", screenX: 0, screenY: 5, localX: 5, localY: 5 }),
        );
        expect(picker.selectedIndex).toBe(1);
    });

    it("hovering does nothing when the list is empty", () => {
        const picker = new QuickPickElement();
        picker.items = [];
        createApp(picker);

        expect(() => {
            mouse(picker, "mousemove", 3);
        }).not.toThrow();
        expect(picker.selectedIndex).toBe(0);
    });

    it("accounts for the scroll offset when mapping the hovered row", () => {
        const picker = new QuickPickElement();
        picker.maxVisibleItems = 3;
        picker.items = makeItems(10);
        const app = createApp(picker, new Size(40, 7));

        // Scroll the window down so index 4 becomes the top visible row.
        for (let i = 0; i < 4; i++) app.sendKey("ArrowDown");
        expect(picker.selectedIndex).toBe(4);

        // First visible row (localY 3) now maps to the scrolled top item (index 2).
        mouse(picker, "mousemove", 3);
        expect(picker.selectedIndex).toBe(2);
    });
});

// ─── Click accepts ────────────────────────────────────────────────────────────

describe("QuickPickElement — mouse click accepts", () => {
    it("left-clicking a row selects and accepts it", () => {
        const picker = new QuickPickElement();
        const items = makeItems(5);
        picker.items = items;
        const onAccept = vi.fn();
        picker.onAccept = onAccept;
        createApp(picker);

        mouse(picker, "click", 5, "left"); // index 2
        expect(picker.selectedIndex).toBe(2);
        expect(onAccept).toHaveBeenCalledWith(items[2], 2);
    });

    it("clicking outside the list does not accept", () => {
        const picker = new QuickPickElement();
        picker.items = makeItems(5);
        const onAccept = vi.fn();
        picker.onAccept = onAccept;
        createApp(picker);

        mouse(picker, "click", 1, "left"); // input row
        expect(onAccept).not.toHaveBeenCalled();
    });

    it("non-left click does not accept", () => {
        const picker = new QuickPickElement();
        picker.items = makeItems(5);
        const onAccept = vi.fn();
        picker.onAccept = onAccept;
        createApp(picker);

        mouse(picker, "click", 5, "none");
        expect(onAccept).not.toHaveBeenCalled();
    });

    it("a hard validation error blocks click accept but still moves the cursor", () => {
        const picker = new QuickPickElement();
        picker.items = makeItems(5);
        picker.validationMessage = "nope";
        picker.validationSeverity = "error";
        const onAccept = vi.fn();
        picker.onAccept = onAccept;
        createApp(picker);

        // With a message row present the list shifts down by one (border, input, message, separator, items).
        mouse(picker, "click", 6, "left"); // firstRow=4 → row 2 = index 2
        expect(picker.selectedIndex).toBe(2);
        expect(onAccept).not.toHaveBeenCalled();
    });
});
