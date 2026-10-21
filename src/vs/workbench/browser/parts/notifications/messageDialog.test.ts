import { BoxConstraints, Point, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { ButtonElement } from "@tuidom/elements/button/buttonElement";
import { describe, expect, it, vi } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import type { IActiveNotification } from "../../../services/notification/browser/notificationService.ts";

import { MESSAGE_DIALOG_CLOSE_LABEL, MESSAGE_DIALOG_ELEMENT_ID, MessageDialog } from "./messageDialog.ts";

function notification(patch: Partial<IActiveNotification> = {}): IActiveNotification {
    return { id: 1, severity: "warn", message: "Delete 12 files?", modal: true, items: [], ...patch };
}

function mount(patch: Partial<IActiveNotification> = {}) {
    const dialog = new MessageDialog(notification(patch));
    const testApp = TestApp.createWithContent(dialog.view, new Size(90, 24));
    const buttons = testApp.querySelectorAll("ButtonElement") as ButtonElement[];
    return { dialog, testApp, buttons };
}

function screen(testApp: TestApp): string {
    testApp.render();
    return testApp.backend.screenToString();
}

describe("MessageDialog — what the frame shows", () => {
    it("the dialog is laid out exactly: text, blank line, detail, CENTERED buttons", () => {
        // Assert the whole frame: pins line order, detail indent and button centering.
        const dialog = new MessageDialog(
            notification({ message: "Delete 12 files?", detail: "Can't be undone.", items: ["Delete", "Cancel"] }),
        );
        const backend = renderElement(dialog.view, 60, 16, {
            constraints: BoxConstraints.loose(new Size(60, 16)),
            themeVars: true,
        });
        const box = backend
            .screenToString()
            .split("\n")
            .map((row) => row.replace(/[\uE000-\uF8FF]/gu, "").replace(/\s+$/, ""))
            .filter((row) => row !== "");

        expect(box).toEqual([
            "╭──────────────────────────╮",
            "│         Warning         │",
            "├──────────────────────────┤",
            "│  Delete 12 files?        │",
            "│                          │",
            "│  Can't be undone.        │",
            "│                          │",
            "│  [ Delete ]  [ Cancel ]  │",
            "╰──────────────────────────╯",
        ]);
    });

    it("buttons are centered across the dialog width, not pushed to an edge", () => {
        // A wide message gives a non-zero offset. Three buttons: with two, `gap * 1` and
        // `gap / 1` give the same result.
        const dialog = new MessageDialog(notification({ message: "x".repeat(50), items: ["Ok", "No", "Maybe"] }));
        const backend = renderElement(dialog.view, 60, 12, {
            constraints: BoxConstraints.loose(new Size(60, 12)),
            themeVars: true,
        });
        const row = backend
            .screenToString()
            .split("\n")
            .find((line) => line.includes("[ Ok ]"));
        const inner = (row ?? "").slice((row ?? "").indexOf("│") + 1, (row ?? "").lastIndexOf("│"));
        const left = inner.length - inner.trimStart().length;
        const right = inner.length - inner.trimEnd().length;

        expect(left).toBeGreaterThan(0);
        expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
    });

    it("the dialog is addressable by the #messageDialog selector", () => {
        const { testApp } = mount();
        expect(testApp.querySelector(`#${MESSAGE_DIALOG_ELEMENT_ID}`)).not.toBeNull();
    });

    it("detail is dimmed so it does not compete with the message text", () => {
        const { testApp } = mount({ detail: "more details" });
        testApp.render();
        const rows = testApp.backend.screenToString().split("\n");
        const detailRow = rows.findIndex((row) => row.includes("more details"));
        const messageRow = rows.findIndex((row) => row.includes("Delete 12 files?"));

        expect(testApp.backend.getFgAt(new Point(rows[detailRow].indexOf("more details"), detailRow))).not.toBe(
            testApp.backend.getFgAt(new Point(rows[messageRow].indexOf("Delete"), messageRow)),
        );
    });

    it("without detail no extra blank line appears in the dialog", () => {
        const withoutDetail = new MessageDialog(notification({ message: "short", items: ["Ok"] }));
        const withDetail = new MessageDialog(notification({ message: "short", detail: "d", items: ["Ok"] }));
        const rows = (dialog: MessageDialog): number =>
            dialog.view.getMaxIntrinsicHeight(dialog.view.getMaxIntrinsicWidth(0));

        expect(rows(withDetail) - rows(withoutDetail)).toBe(2);
    });

    it("severity title, text and buttons", () => {
        const { testApp } = mount({ items: ["Delete", "Cancel"] });
        const text = screen(testApp);
        expect(text).toContain("Warning");
        expect(text).toContain("Delete 12 files?");
        expect(text).toContain("Cancel");
    });

    it("detail is shown on its own line", () => {
        const { testApp } = mount({ detail: "This action cannot be undone." });
        expect(screen(testApp)).toContain("This action cannot be undone.");
    });

    it("long text wraps at word boundaries", () => {
        const { testApp } = mount({ message: "word ".repeat(40) });
        const rows = screen(testApp).split("\n");
        const contentRows = rows.filter((row) => row.includes("word"));
        expect(contentRows.length).toBeGreaterThan(1);
    });

    it("without buttons a single OK appears: otherwise the dialog cannot be closed", () => {
        const { buttons, testApp } = mount();
        expect(buttons.map((b) => b.getLabel())).toEqual([MESSAGE_DIALOG_CLOSE_LABEL]);
        expect(screen(testApp)).toContain(MESSAGE_DIALOG_CLOSE_LABEL);
    });
});

describe("MessageDialog — response", () => {
    it("Enter on a button returns its index", () => {
        const { dialog, testApp, buttons } = mount({ items: ["Delete", "Cancel"] });
        const onSelect = vi.fn();
        dialog.onSelect = onSelect;

        buttons[1].focus();
        testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));

        expect(onSelect).toHaveBeenCalledWith(1);
    });

    it("focusDefault moves focus to the first button", () => {
        const { dialog, testApp, buttons } = mount({ items: ["Delete", "Cancel"] });
        dialog.focusDefault();
        expect(testApp.focusedElement).toBe(buttons[0]);
    });

    it("Escape returns the isCloseAffordance button", () => {
        const { dialog, testApp } = mount({ items: ["Delete", "Cancel"], closeAffordance: 1 });
        const onSelect = vi.fn();
        const onClose = vi.fn();
        dialog.onSelect = onSelect;
        dialog.onClose = onClose;
        dialog.focusDefault();

        testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Escape" }));

        expect(onSelect).toHaveBeenCalledWith(1);
        expect(onClose).not.toHaveBeenCalled();
    });

    it("without isCloseAffordance Escape closes without a choice", () => {
        const { dialog, testApp } = mount({ items: ["Delete", "Cancel"] });
        const onSelect = vi.fn();
        const onClose = vi.fn();
        dialog.onSelect = onSelect;
        dialog.onClose = onClose;
        dialog.focusDefault();

        testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Escape" }));

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('the OK button of a message without buttons means "closed without a choice"', () => {
        const { dialog, testApp, buttons } = mount();
        const onClose = vi.fn();
        const onSelect = vi.fn();
        dialog.onClose = onClose;
        dialog.onSelect = onSelect;

        buttons[0].focus();
        testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onSelect).not.toHaveBeenCalled();
    });

    it("a dialog without handlers crashes on neither Enter nor Escape", () => {
        const withItems = mount({ items: ["Delete", "Cancel"], closeAffordance: 1 });
        withItems.dialog.focusDefault();
        expect(() => {
            withItems.buttons[0].dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));
            withItems.testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Escape" }));
        }).not.toThrow();

        const withoutItems = mount();
        withoutItems.dialog.focusDefault();
        expect(() => {
            withoutItems.buttons[0].dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));
            withoutItems.testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Escape" }));
        }).not.toThrow();
    });

    it("←/→ move between buttons", () => {
        const { dialog, testApp, buttons } = mount({ items: ["Delete", "Cancel"] });
        dialog.focusDefault();

        testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "ArrowRight" }));
        expect(testApp.focusedElement).toBe(buttons[1]);
    });

    it("the button row is built with ONE stretching spacer (two throw in the engine)", () => {
        // Centering with two fill children crashed the window on build, and the failure reached the extension.
        expect(() => mount({ items: ["One", "Two", "Three"] })).not.toThrow();
    });
});
