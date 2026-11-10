import { Size } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { ButtonElement } from "@tuidom/elements/button/buttonElement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";
import {
    ExtensionProgressAdapter,
    PROGRESS_NOTIFICATION_MIN_VISIBLE_MS,
} from "../../../api/browser/extensionProgressAdapter.ts";
import { ProgressStatusBarAdapter } from "../../../api/browser/progressStatusBarAdapter.ts";
import { NotificationService } from "../../../services/notification/browser/notificationService.ts";
import { StatusBarService } from "../../../services/statusbar/common/statusBarService.ts";

import { NotificationsComponent } from "./notificationsComponent.ts";
import { TOAST_CLOSE_LABEL, TOAST_SPINNER_INTERVAL_MS } from "./notificationToast.ts";

/** The extension side of the host: the adapter `withProgress` reaches through `window.progress.*`. */
function makeWorkbench() {
    const notifications = new NotificationService();
    const component = new NotificationsComponent(notifications, new KeybindingRegistry(), new ContextKeyService());
    const statusBar = new StatusBarService(NULL_STATE_SERVICE);
    const window = new ProgressStatusBarAdapter(statusBar, 100);
    const adapter = new ExtensionProgressAdapter(window, notifications, {
        start: () => undefined,
        end: () => undefined,
    });
    const body = new BodyElement();
    // Stands in for the editor: where focus is before "Focus Message" and must return to after.
    const editor = new ButtonElement("editor");
    body.setContent(editor);
    const testApp = TestApp.create(body, new Size(80, 24));
    component.attachHost(body);
    editor.focus();
    let cancels = 0;
    const start = (cancellable = true): void => {
        adapter.start(1, { title: "Diode Notify", location: "notification", cancellable }, () => {
            cancels++;
        });
    };
    return {
        notifications,
        component,
        statusBar,
        window,
        adapter,
        editor,
        testApp,
        start,
        cancels: () => cancels,
    };
}

function screen(testApp: TestApp): string {
    testApp.render();
    return testApp.backend.screenToString();
}

function pressEnter(testApp: TestApp): void {
    testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));
}

describe("NotificationsComponent — progress toast", () => {
    let w: ReturnType<typeof makeWorkbench>;

    beforeEach(() => {
        vi.useFakeTimers();
        w = makeWorkbench();
    });
    afterEach(() => {
        w.component.dispose();
        w.window.dispose();
        vi.useRealTimers();
    });

    it("[api:window.withProgress] the frame: `title: message`, the percent, Cancel and no ×", () => {
        w.start();
        w.adapter.report(1, "Long Progress", 42);

        const text = screen(w.testApp);
        expect(text).toContain("Diode Notify: Long Progress");
        expect(text).toContain("42%");
        expect(text).toContain("Cancel");
        expect(text).not.toContain(TOAST_CLOSE_LABEL);
        // The toast does not take focus.
        expect(w.testApp.focusedElement).toBe(w.editor);
    });

    it("until the first increment a spinner turns in place of the percent", () => {
        w.start(false);

        expect(screen(w.testApp)).toContain("⠋");
        vi.advanceTimersByTime(TOAST_SPINNER_INTERVAL_MS);
        expect(screen(w.testApp)).toContain("⠙");
        expect(screen(w.testApp)).not.toContain("Cancel");
    });

    it("every report redraws the same toast, a long message rewraps", () => {
        w.start();
        w.adapter.report(1, "one", 10);
        expect(screen(w.testApp)).toContain("Diode Notify: one");

        w.adapter.report(1, "a message long enough to wrap over two lines of the narrow toast", 5);

        const text = screen(w.testApp);
        expect(text).not.toContain("Diode Notify: one");
        expect(text).toContain("narrow toast");
        expect(text).toContain("15%");
        expect(w.notifications.passive()).toHaveLength(1);
    });

    it("[api:window.withProgress] Focus Message, then Enter: Cancel fires once, the toast goes, focus returns", () => {
        w.start();

        expect(w.component.focusAsk()).toBe(true);
        expect((w.testApp.focusedElement as ButtonElement).getLabel()).toBe("Cancel");
        pressEnter(w.testApp);

        expect(w.cancels()).toBe(1);
        expect(screen(w.testApp)).not.toContain("Diode Notify");
        expect(w.testApp.focusedElement).toBe(w.editor);
    });

    it("reports keep the focus on Cancel, even when the message rewraps", () => {
        w.start();
        w.component.focusAsk();
        const cancel = w.testApp.focusedElement;

        w.adapter.report(1, "step", 10);
        w.adapter.report(1, "a message long enough to wrap over two lines of the narrow toast", 10);

        expect(w.testApp.focusedElement).toBe(cancel);
        pressEnter(w.testApp);
        expect(w.cancels()).toBe(1);
    });

    it("a click on Cancel cancels too", () => {
        w.start();
        screen(w.testApp);
        const cancel = w.testApp.querySelectorAll("ButtonElement").find((b) => b !== w.editor) as ButtonElement;

        cancel.onActivate?.();

        expect(w.cancels()).toBe(1);
        expect(w.notifications.passive()).toEqual([]);
    });

    it("after the progress ended its Cancel is gone for Focus Message too", () => {
        w.start();
        w.adapter.end(1);
        vi.advanceTimersByTime(PROGRESS_NOTIFICATION_MIN_VISIBLE_MS);

        expect(w.component.focusAsk()).toBe(false);
    });

    it("a host outside an application (no focus manager): Focus Message and Cancel still work", () => {
        const notifications = new NotificationService();
        const component = new NotificationsComponent(notifications, new KeybindingRegistry(), new ContextKeyService());
        component.attachHost(new BodyElement());
        let cancelled = 0;
        notifications.showProgress({
            message: "Indexing",
            cancellable: true,
            onCancel: () => {
                cancelled++;
            },
            onHide: () => undefined,
        });

        expect(component.focusAsk()).toBe(true);
        notifications.answer(notifications.passive()[0].id, 0);

        expect(cancelled).toBe(1);
        expect(notifications.passive()).toEqual([]);
        component.dispose();
    });

    it("without Cancel there is nothing for Focus Message", () => {
        w.start(false);

        expect(w.component.focusAsk()).toBe(false);
        expect(w.testApp.focusedElement).toBe(w.editor);
    });

    it("the task ends: the toast goes after the minimum, focus moved elsewhere stays there", () => {
        w.start();
        w.component.focusAsk();
        const other = new ButtonElement("other");
        w.testApp.root.setStatusBar(other);
        other.focus();

        w.adapter.end(1);
        vi.advanceTimersByTime(PROGRESS_NOTIFICATION_MIN_VISIBLE_MS);

        expect(screen(w.testApp)).not.toContain("Diode Notify");
        expect(w.testApp.focusedElement).toBe(other);
        expect(w.cancels()).toBe(0);
    });

    it("Clear All moves a running progress to the status bar", () => {
        w.start();
        w.adapter.report(1, "half", 50);

        w.notifications.clearAll();

        expect(screen(w.testApp)).not.toContain("Diode Notify");
        expect(w.statusBar.entries().map((e) => e.text.slice(2))).toEqual(["Diode Notify · half (50%)"]);
    });

    it("Escape on a focused progress toast hides it to the status bar, without cancelling", () => {
        w.start();
        w.component.focusAsk();

        w.testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Escape" }));

        expect(w.cancels()).toBe(0);
        expect(w.statusBar.entries().map((e) => e.text.slice(2))).toEqual(["Diode Notify"]);
        expect(w.testApp.focusedElement).toBe(w.editor);
    });
});
