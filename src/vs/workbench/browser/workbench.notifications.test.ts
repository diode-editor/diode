import * as path from "node:path";

import { Point } from "@tuidom/core/common/geometryPromitives";
import { ButtonElement } from "@tuidom/elements/button/buttonElement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import {
    MAX_VISIBLE_NOTIFICATIONS,
    NOTIFICATION_AUTO_HIDE_MS,
    type NotificationService,
    NotificationServiceDIToken,
} from "../services/notification/browser/notificationService.ts";

import { NotificationsComponentDIToken, TOAST_WIDTH } from "./parts/notifications/notificationsComponent.ts";

describe("Workbench — messages on the frame", () => {
    let ws: ITempWorkspace;
    // The Explorer section is named after the open folder (#898); a short prefix keeps the name within the
    // 30-column sidebar, where a long title is clipped before the header buttons.
    const folderTitle = (): string => path.basename(ws.dir).toUpperCase();
    let h: IAppHarness;
    let notifications: NotificationService;

    beforeEach(async () => {
        ws = createTempWorkspace({ prefix: "ws-", files: { "alpha.txt": "Alpha content" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir, openFile: `${ws.dir}/alpha.txt`, focusEditor: true });
        await h.workbench.activate();
        await h.workbench.fileIndexReady;
        notifications = h.container.get(NotificationServiceDIToken);
        h.testApp.render();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    function screen(): string {
        h.testApp.render();
        return h.testApp.backend.screenToString();
    }

    it("a message without buttons is visible on the frame", () => {
        notifications.show({ severity: "info", message: "Ruff: formatted 3 files", modal: false, items: [] });
        const text = screen();

        expect(text).toContain("Ruff: formatted 3 files");
        expect(text).toContain("Information");
    });

    it("the toast sits in the bottom-right corner ABOVE the status bar", () => {
        notifications.show({ severity: "error", message: "boom", modal: false, items: [] });
        const rows = screen().split("\n");
        const { width, height } = h.testApp.root.layoutSize;

        const boxRows = rows.map((row, y) => ({ y, x: row.indexOf("╭") })).filter((r) => r.x >= 0);
        expect(boxRows).toHaveLength(1);
        expect(boxRows[0].x).toBe(width - 1 - TOAST_WIDTH);
        const bottomRow = rows.findIndex((row) => row.includes("╰"));
        expect(bottomRow).toBe(height - 2);
    });

    it("several messages form a stack; those waiting for room become a counter", () => {
        for (const message of ["one", "two", "three", "four", "five"]) {
            notifications.show({ severity: "error", message, modal: false, items: [] });
        }
        const text = screen();

        expect(text).toContain("one");
        expect(text).toContain("two");
        expect(text).toContain("three");
        expect(text).not.toContain("five");
        expect(text).toContain(`+${String(5 - MAX_VISIBLE_NOTIFICATIONS)} more`);
    });

    it("a waiting toast joins the stack on its own once the one ahead is closed", () => {
        const first = notifications.show({ severity: "error", message: "one", modal: false, items: [] });
        for (const message of ["two", "three", "four"]) {
            notifications.show({ severity: "error", message, modal: false, items: [] });
        }
        expect(screen()).not.toContain("four");

        notifications.dismiss(first.id);

        expect(screen()).toContain("four");
    });

    it("info fades by itself and leaves the frame", () => {
        vi.useFakeTimers();
        notifications.show({ severity: "info", message: "transient", modal: false, items: [] });
        expect(screen()).toContain("transient");

        vi.advanceTimersByTime(NOTIFICATION_AUTO_HIDE_MS.info);
        expect(screen()).not.toContain("transient");
    });

    it("a question with buttons does NOT take focus: typing in the editor continues", () => {
        const before = h.testApp.focusedElement;
        notifications.show({
            severity: "warn",
            message: "Activate Supermaven?",
            modal: false,
            items: ["Activate", "Free"],
        });
        const text = screen();

        expect(text).toContain("Activate");
        expect(text).toContain("F6 — reply");
        expect(h.testApp.focusedElement).toBe(before);
    });

    it("the focus command moves to the buttons, Enter gives the answer", async () => {
        const answered = notifications.show({
            severity: "warn",
            message: "Activate?",
            modal: false,
            items: ["Activate", "Free"],
        });
        screen();

        await h.commands.execute("notifications.focusMessage");
        h.testApp.render();
        expect(screen()).toContain("Enter — choose");

        h.testApp.sendKey("ArrowRight");
        h.testApp.sendKey("Enter");

        await expect(answered.answered).resolves.toBe(1);
        expect(screen()).not.toContain("Activate?");
    });

    it("Tab inside a toast does not type an indent in the editor", async () => {
        // Focus is in the toast, but global bindings stay live: unless the toast intercepts Tab itself,
        // the keystroke would reach the editor and insert an indent into the file.
        notifications.show({ severity: "info", message: "Activate?", modal: false, items: ["Activate", "Free"] });
        screen();
        await h.commands.execute("notifications.focusMessage");
        const textBefore = h.activeEditor().getText();

        h.testApp.sendKey("Tab");

        expect(h.activeEditor().getText()).toBe(textBefore);
    });

    it("Escape in a toast closes the question without a choice", async () => {
        const answered = notifications.show({
            severity: "warn",
            message: "Activate?",
            modal: false,
            items: ["Activate"],
        });
        screen();
        await h.commands.execute("notifications.focusMessage");
        h.testApp.sendKey("Escape");

        await expect(answered.answered).resolves.toBeUndefined();
        expect(screen()).not.toContain("Activate?");
    });

    it("the Clear All command removes everything from the frame", async () => {
        notifications.show({ severity: "error", message: "boom", modal: false, items: [] });
        const answered = notifications.show({ severity: "info", message: "Activate?", modal: false, items: ["One"] });
        expect(screen()).toContain("boom");

        await h.commands.execute("notifications.clearAll");

        const text = screen();
        expect(text).not.toContain("boom");
        expect(text).not.toContain("Activate?");
        await expect(answered.answered).resolves.toBeUndefined();
    });

    it("a modal message raises a centered window and holds the keyboard", async () => {
        const answered = notifications.show({
            severity: "warn",
            message: "Delete 12 files?",
            detail: "Cannot be undone.",
            modal: true,
            items: ["Delete", "Cancel"],
            closeAffordance: 1,
        });
        const rows = screen().split("\n");

        expect(rows.join("\n")).toContain("Delete 12 files?");
        expect(rows.join("\n")).toContain("Cannot be undone.");
        const left = rows.find((row) => row.includes("╭"))?.indexOf("╭") ?? -1;
        expect(left).toBeGreaterThan(0);
        expect(left).toBeLessThan(h.testApp.root.layoutSize.width - 1 - TOAST_WIDTH);

        h.testApp.sendKey("Escape");
        // Escape on a modal returns the isCloseAffordance button.
        await expect(answered.answered).resolves.toBe(1);
    });

    it("a modal message focuses its first button: Enter answers it, and OK of a message without buttons closes it", async () => {
        const question = notifications.show({
            severity: "info",
            message: "Proceed?",
            modal: true,
            items: ["Proceed", "Cancel"],
        });
        expect(h.testApp.focusedElement).toBeInstanceOf(ButtonElement);
        h.testApp.sendKey("Enter");
        await expect(question.answered).resolves.toBe(0);

        const info = notifications.show({ severity: "info", message: "All done.", modal: true, items: [] });
        h.testApp.sendKey("Enter");
        await expect(info.answered).resolves.toBeUndefined();
        expect(screen()).not.toContain("All done.");
    });

    it("a passive toast expiring under a modal does not reset its button choice", () => {
        notifications.show({ severity: "info", message: "Pick", modal: true, items: ["One", "Two"] });
        h.testApp.sendKey("ArrowRight");
        const chosen = h.testApp.focusedElement;
        notifications.show({ severity: "error", message: "passive", modal: false, items: [] });
        expect(h.testApp.focusedElement).toBe(chosen);
    });

    it("the next question shows by itself once the previous one is answered", async () => {
        const first = notifications.show({ severity: "info", message: "first?", modal: false, items: ["One"] });
        notifications.show({ severity: "info", message: "second?", modal: false, items: ["Two"] });

        expect(screen()).toContain("first?");
        expect(screen()).not.toContain("second?");

        notifications.answer(first.id, 0);
        await first.answered;
        expect(screen()).toContain("second?");
    });

    it("after a question closes, the passive stack drops to the status bar", () => {
        notifications.show({ severity: "error", message: "sticky", modal: false, items: [] });
        const ask = notifications.show({ severity: "info", message: "question?", modal: false, items: ["One"] });
        const withAsk = screen()
            .split("\n")
            .findIndex((row) => row.includes("sticky"));

        notifications.dismiss(ask.id);
        const withoutAsk = screen()
            .split("\n")
            .findIndex((row) => row.includes("sticky"));

        expect(withAsk).toBeGreaterThan(0);
        expect(withoutAsk).toBeGreaterThan(withAsk);
    });

    it("global keybindings work through a PASSIVE toast — the stack does not take the keyboard", () => {
        notifications.show({ severity: "error", message: "boom", modal: false, items: [] });
        const sidebarBefore = screen().includes(folderTitle());

        h.testApp.sendKey("Ctrl+B");

        expect(screen().includes(folderTitle())).toBe(!sidebarBefore);
        expect(screen()).toContain("boom");
    });

    it("a click outside a MODAL window does not reach the editor, outside a toast it does", () => {
        // A modal swallows the click, a toast lets it through (pointerPolicy); this shows in
        // focus: a click that reaches the tree takes focus away from the editor.
        const click = (x: number, y: number): void => {
            for (const action of ["press", "release"] as const) {
                h.testApp.backend.simulateMouse({
                    kind: "mouse",
                    button: "left",
                    action,
                    x,
                    y,
                    shiftKey: false,
                    altKey: false,
                    ctrlKey: false,
                    raw: "",
                });
            }
            h.testApp.render();
        };

        notifications.show({ severity: "warn", message: "Delete?", modal: true, items: ["Delete"] });
        screen();
        const inModal = h.testApp.focusedElement;
        click(5, 3);
        expect(h.testApp.focusedElement).toBe(inModal);

        notifications.clearAll();
        notifications.show({ severity: "error", message: "boom", modal: false, items: [] });
        screen();
        const beforeToast = h.testApp.focusedElement;
        click(5, 3);
        expect(h.testApp.focusedElement).not.toBe(beforeToast);
    });

    it("while a question toast is up, global keybindings work — the keyboard is not locked", async () => {
        notifications.show({ severity: "info", message: "Activate?", modal: false, items: ["One"] });
        screen();

        // Ctrl+B toggles the sidebar; it must work through a question toast.
        const sidebarBefore = screen().includes(folderTitle());
        h.testApp.sendKey("Ctrl+B");
        expect(screen().includes(folderTitle())).toBe(!sidebarBefore);
        expect(screen()).toContain("Activate?");
        await Promise.resolve();
    });

    it("while a MODAL message is up, global keybindings are disabled", () => {
        notifications.show({ severity: "warn", message: "Delete?", modal: true, items: ["Delete"] });
        screen();

        const sidebarBefore = screen().includes(folderTitle());
        h.testApp.sendKey("Ctrl+B");

        expect(screen().includes(folderTitle())).toBe(sidebarBefore);
        expect(screen()).toContain("Delete?");
    });

    it("a modal window takes focus, a question toast does not", () => {
        const before = h.testApp.focusedElement;
        notifications.show({ severity: "info", message: "toast?", modal: false, items: ["One"] });
        screen();
        expect(h.testApp.focusedElement).toBe(before);

        notifications.clearAll();
        notifications.show({ severity: "warn", message: "modal?", modal: true, items: ["Delete"] });
        screen();
        expect(h.testApp.focusedElement).not.toBe(before);
    });

    it("focus returns where it was once the question closes", async () => {
        const before = h.testApp.focusedElement;
        const answered = notifications.show({ severity: "info", message: "Activate?", modal: false, items: ["One"] });
        screen();
        await h.commands.execute("notifications.focusMessage");
        expect(h.testApp.focusedElement).not.toBe(before);

        h.testApp.sendKey("Escape");
        await answered.answered;

        expect(h.testApp.focusedElement).toBe(before);
    });

    it("an incoming toast does not reset the position in a modal window", () => {
        // Positions are recomputed on EVERY change to the set of messages; if that
        // resets focus to the default, the user loses the selected button.
        notifications.show({ severity: "warn", message: "Delete?", modal: true, items: ["Delete", "Cancel"] });
        screen();
        h.testApp.sendKey("ArrowRight");
        const chosen = h.testApp.focusedElement;

        notifications.show({ severity: "info", message: "in passing", modal: false, items: [] });
        screen();

        expect(h.testApp.focusedElement).toBe(chosen);
    });

    it("a modal window is centered vertically, not pinned to the top", () => {
        notifications.show({
            severity: "warn",
            message: "Delete?",
            detail: "Cannot be undone.",
            modal: true,
            items: ["Delete"],
        });
        const rows = screen().split("\n");
        const top = rows.findIndex((row) => row.includes("╭"));
        const bottom = rows.findIndex((row) => row.includes("╰"));
        const height = h.testApp.root.layoutSize.height;

        expect(top).toBeGreaterThan(1);
        expect(height - 1 - bottom).toBeGreaterThan(1);
        expect(Math.abs(top - (height - 1 - bottom))).toBeLessThanOrEqual(1);
    });

    it("«+N more» appears only when something actually waits for room", () => {
        notifications.show({ severity: "error", message: "only one", modal: false, items: [] });
        expect(screen()).not.toContain("more");
    });

    it("the waiting counter is dimmed — it does not compete with the message text", () => {
        for (const message of ["one", "two", "three", "four"]) {
            notifications.show({ severity: "error", message, modal: false, items: [] });
        }
        const rows = screen().split("\n");
        const counterRow = rows.findIndex((row) => row.includes("more"));
        // "four" is waiting for room and not drawn — compare against a visible message.
        const messageRow = rows.findIndex((row) => row.includes("one"));

        expect(h.testApp.backend.getFgAt(new Point(rows[counterRow].indexOf("+"), counterRow))).not.toBe(
            h.testApp.backend.getFgAt(new Point(rows[messageRow].indexOf("one"), messageRow)),
        );
    });

    it("the focus command without a live question does nothing", async () => {
        const before = h.testApp.focusedElement;
        await h.commands.execute("notifications.focusMessage");
        expect(h.testApp.focusedElement).toBe(before);
        expect(h.container.get(NotificationsComponentDIToken).getOpenAsk()).toBeNull();
    });
});
