import { BoxConstraints, Point, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { ButtonElement } from "@tuidom/elements/button/buttonElement";
import { SizedBoxElement } from "@tuidom/elements/layout/sizedBoxElement";
import { VStackElement } from "@tuidom/elements/layout/vStackElement";
import type { MockTerminalBackend } from "@tuidom/testing/mockTerminalBackend";
import { describe, expect, it, vi } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import type { IActiveNotification } from "../../../services/notification/browser/notificationService.ts";

import {
    NotificationToast,
    TOAST_CLOSE_LABEL,
    TOAST_ELEMENT_ID,
    TOAST_HINT_FOCUSED,
    TOAST_MAX_LINES,
    TOAST_TEXT_WIDTH,
    toastLines,
    toastUnfocusedHint,
} from "./notificationToast.ts";

function notification(patch: Partial<IActiveNotification> = {}): IActiveNotification {
    return { id: 1, severity: "info", message: "hello", modal: false, items: [], ...patch };
}

const TOAST_WIDTH = TOAST_TEXT_WIDTH + 6;

/** A FIXED-width wrapper, as in `NotificationsComponent`: otherwise the button row spacer would stretch the frame across the screen. */
function mount(patch: Partial<IActiveNotification> = {}, keyLabel = "F6") {
    const toast = new NotificationToast(notification(patch), keyLabel);
    const holder = new SizedBoxElement(TOAST_WIDTH);
    holder.setChild(toast.view);
    const testApp = TestApp.createWithContent(holder, new Size(70, 20));
    const buttons = testApp.querySelectorAll("ButtonElement") as ButtonElement[];
    return { toast, testApp, buttons };
}

function screen(testApp: TestApp): string {
    testApp.render();
    return testApp.backend.screenToString();
}

/** Under the test app's tight constraints the button row would stretch the frame across the screen. */
function renderToast(patch: Partial<IActiveNotification> = {}, keyLabel = "F6"): MockTerminalBackend {
    const toast = new NotificationToast(notification(patch), keyLabel);
    const holder = new SizedBoxElement(TOAST_WIDTH);
    holder.setChild(toast.view);
    return renderElement(holder, TOAST_WIDTH, 16, {
        constraints: BoxConstraints.loose(new Size(TOAST_WIDTH, 16)),
        themeVars: true,
    });
}

/** Codicon glyphs (Unicode private use area) are stripped: they only get in the way of text comparison. */
function boxLines(backend: MockTerminalBackend): string[] {
    return backend
        .screenToString()
        .split("\n")
        .map((row) => row.replace(/[\uE000-\uF8FF]/gu, "").replace(/\s+$/, ""))
        .filter((row) => row !== "");
}

describe("toastLines", () => {
    it("wraps long text at word boundaries", () => {
        const lines = toastLines("Thank you for installing Supermaven! Click 'Activate' to set up a subscription");
        expect(lines.length).toBeGreaterThan(1);
        for (const line of lines) expect(line.length).toBeLessThanOrEqual(46);
    });

    it("short text stays on one line", () => {
        expect(toastLines("short")).toEqual(["short"]);
    });

    it("text that is too long ends in an ellipsis: the toast does not grow to fill the screen", () => {
        const lines = toastLines("word ".repeat(200));
        expect(lines).toHaveLength(TOAST_MAX_LINES);
        expect(lines.at(-1)).toBe("…");
    });

    it("exactly the line limit is kept whole, without an ellipsis", () => {
        // Exactly TOAST_MAX_LINES lines is NOT yet "too many".
        const exact = Array.from({ length: TOAST_MAX_LINES }, (_, i) => "x".repeat(40) + String(i)).join(" ");
        const lines = toastLines(exact);
        expect(lines).toHaveLength(TOAST_MAX_LINES);
        expect(lines.at(-1)).not.toBe("…");
    });
});

describe("toastUnfocusedHint", () => {
    it("names the active key combination", () => {
        expect(toastUnfocusedHint("F6")).toBe("F6 — reply");
        expect(toastUnfocusedHint("Alt+M")).toBe("Alt+M — reply");
    });

    it("without a binding it names the command — it can be found in the command palette", () => {
        expect(toastUnfocusedHint(undefined)).toContain("Notifications: Focus Message");
    });
});

describe("NotificationToast — what the frame shows", () => {
    it("a question frame is laid out exactly: text, blank line, buttons on the right, hint", () => {
        // Assert the WHOLE frame: pins line order, padding and right-aligned buttons.
        const box = boxLines(renderToast({ severity: "warn", message: "Upload failed", items: ["Retry", "Cancel"] }));
        expect(box).toEqual([
            "╭──────────────────────────────────────────────────╮",
            // The severity icon is a codicon from the Unicode private use area, "invisible" in text.
            "│                     Warning                     │",
            "├──────────────────────────────────────────────────┤",
            "│  Upload failed                                   │",
            "│                                                  │",
            "│                      [ Retry ] [ Cancel ] [ × ]  │",
            "│  F6 — reply                                      │",
            "╰──────────────────────────────────────────────────╯",
        ]);
    });

    it("the title uses the severity accent, not the text color", () => {
        const { testApp } = mount({ severity: "error" });
        testApp.render();
        const rows = testApp.backend.screenToString().split("\n");
        const titleRow = rows.findIndex((row) => row.includes("Error"));
        const titleCol = rows[titleRow].indexOf("Error");
        const messageRow = rows.findIndex((row) => row.includes("hello"));
        const messageCol = rows[messageRow].indexOf("hello");

        expect(testApp.backend.getFgAt(new Point(titleCol, titleRow))).not.toBe(
            testApp.backend.getFgAt(new Point(messageCol, messageRow)),
        );
    });

    it("the hint is dimmed so it does not compete with the message text", () => {
        const { testApp } = mount({ items: ["One"] });
        testApp.render();
        const rows = testApp.backend.screenToString().split("\n");
        const hintRow = rows.findIndex((row) => row.includes("F6"));
        const messageRow = rows.findIndex((row) => row.includes("hello"));

        expect(testApp.backend.getFgAt(new Point(rows[hintRow].indexOf("F6"), hintRow))).not.toBe(
            testApp.backend.getFgAt(new Point(rows[messageRow].indexOf("hello"), messageRow)),
        );
    });

    it("the toast is addressable by the #notificationToast selector", () => {
        const { testApp } = mount();
        expect(testApp.querySelector(`#${TOAST_ELEMENT_ID}`)).not.toBeNull();
    });

    it("severity shows as the title", () => {
        expect(screen(mount({ severity: "info" }).testApp)).toContain("Information");
        expect(screen(mount({ severity: "warn" }).testApp)).toContain("Warning");
        expect(screen(mount({ severity: "error" }).testApp)).toContain("Error");
    });

    it("the message text and button labels are drawn", () => {
        const { testApp } = mount({ message: "Ruff: formatted", items: ["Activate", "Free"] });
        const text = screen(testApp);
        expect(text).toContain("Ruff: formatted");
        expect(text).toContain("Activate");
        expect(text).toContain("Free");
    });

    it("a toast without buttons has no hint — there is nothing to reply", () => {
        const { toast, testApp } = mount();
        expect(toast.hintText()).toBeNull();
        expect(screen(testApp)).not.toContain("reply");
    });

    it("a toast with buttons has a hint telling how to reach them", () => {
        const { toast, testApp } = mount({ items: ["One"] });
        expect(toast.hintText()).toBe("F6 — reply");
        expect(screen(testApp)).toContain("F6 — reply");
    });
});

describe("NotificationToast — keyboard reply", () => {
    it("isInteractive tells a question from a passive toast", () => {
        expect(mount({ items: ["One"] }).toast.isInteractive).toBe(true);
        expect(mount().toast.isInteractive).toBe(false);
    });

    it("focusDefault moves focus to the first button and changes the hint", () => {
        const { toast, testApp, buttons } = mount({ items: ["Activate", "Free"] });
        toast.focusDefault();

        expect(testApp.focusedElement).toBe(buttons[0]);
        expect(toast.hintText()).toBe(TOAST_HINT_FOCUSED);
    });

    it("a passive toast has a single close button in its row, and focus lands on it", () => {
        const { toast, testApp, buttons } = mount();
        expect(buttons.map((b) => b.getLabel())).toEqual([TOAST_CLOSE_LABEL]);

        toast.focusDefault();
        expect(testApp.focusedElement).toBe(buttons[0]);
    });

    it("the close button of a passive toast closes it", () => {
        const { toast, testApp, buttons } = mount();
        const onClose = vi.fn();
        toast.onClose = onClose;

        buttons[0].focus();
        testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("the close button of a question does not count as a reply", () => {
        const { toast, testApp, buttons } = mount({ items: ["Activate"] });
        const onSelect = vi.fn();
        const onClose = vi.fn();
        toast.onSelect = onSelect;
        toast.onClose = onClose;

        buttons.at(-1)?.focus();
        testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onSelect).not.toHaveBeenCalled();
    });

    it("Enter on a button returns its index", () => {
        const { toast, testApp, buttons } = mount({ items: ["Activate", "Free"] });
        const onSelect = vi.fn();
        toast.onSelect = onSelect;
        toast.focusDefault();

        buttons[1].focus();
        testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));

        expect(onSelect).toHaveBeenCalledWith(1);
    });

    it("←/→ move along the button row", () => {
        const { toast, testApp, buttons } = mount({ items: ["A", "B"] });
        toast.focusDefault();

        testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "ArrowRight" }));
        expect(testApp.focusedElement).toBe(buttons[1]);

        testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "ArrowLeft" }));
        expect(testApp.focusedElement).toBe(buttons[0]);
    });

    it("Tab cycles around instead of moving focus out of the toast", () => {
        const { toast, testApp, buttons } = mount({ items: ["A"] });
        expect(buttons).toHaveLength(2);
        toast.focusDefault();

        testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Tab" }));
        expect(testApp.focusedElement).toBe(buttons[1]);

        testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Tab" }));
        expect(testApp.focusedElement).toBe(buttons[0]);
    });

    it("Tab goes forward, Shift+Tab back — visible with three buttons", () => {
        // With two buttons both wrap directions lead to the same one; direction is distinguishable from three.
        const forward = mount({ items: ["A", "B"] });
        forward.toast.focusDefault();
        forward.testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Tab" }));
        expect(forward.testApp.focusedElement).toBe(forward.buttons[1]);

        const back = mount({ items: ["A", "B"] });
        back.toast.focusDefault();
        back.testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Tab", shiftKey: true }));
        expect(back.testApp.focusedElement).toBe(back.buttons.at(-1));
    });

    it("Tab does not move focus from the toast to its tree neighbors", () => {
        // The session is passthrough: without intercepting Tab, focus would go to another focusable.
        const toast = new NotificationToast(notification({ items: ["A", "B"] }), "F6");
        const outsider = new ButtonElement("outside");
        const stack = new VStackElement();
        stack.addChild(toast.view, { width: "stretch", height: 12 });
        stack.addChild(outsider, { width: "stretch", height: 1 });
        const testApp = TestApp.createWithContent(stack, new Size(70, 20));
        const buttons = testApp.querySelectorAll("ButtonElement") as ButtonElement[];
        toast.focusDefault();

        for (let i = 0; i < 4; i++) {
            testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Tab" }));
        }

        expect(buttons).toContain(testApp.focusedElement);
        expect(testApp.focusedElement).not.toBe(outsider);
    });

    it("a toast without handlers crashes on none of Enter, Escape or Tab", () => {
        // Keys reach a passive toast too (focused via the command, then Escape).
        const { toast, testApp, buttons } = mount({ items: ["One"] });
        toast.focusDefault();
        expect(() => {
            buttons[0].dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));
            testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Escape" }));
        }).not.toThrow();

        const passive = mount();
        expect(() => {
            passive.toast.view.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Tab" }));
            // The component sets the close button handler; the widget works without it too.
            passive.buttons[0].dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));
        }).not.toThrow();
    });

    it("Escape closes without a choice", () => {
        const { toast, testApp } = mount({ items: ["One"] });
        const onClose = vi.fn();
        const onSelect = vi.fn();
        toast.onClose = onClose;
        toast.onSelect = onSelect;
        toast.focusDefault();

        testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Escape" }));

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('the hint goes back to "how to reply" when focus leaves the toast', () => {
        const { toast, testApp, buttons } = mount({ items: ["One"] });
        toast.focusDefault();
        expect(toast.hintText()).toBe(TOAST_HINT_FOCUSED);

        buttons[0].blur();
        void testApp;
        expect(toast.hintText()).toBe("F6 — reply");
    });
});
