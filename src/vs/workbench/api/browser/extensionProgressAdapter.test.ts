import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NULL_STATE_SERVICE } from "../../../platform/state/common/nullStateService.ts";
import { NotificationService } from "../../services/notification/browser/notificationService.ts";
import { StatusBarService } from "../../services/statusbar/common/statusBarService.ts";
import type { IProgressStartOptions } from "../common/iExtensionWindowSinks.ts";

import { ExtensionProgressAdapter, PROGRESS_NOTIFICATION_MIN_VISIBLE_MS } from "./extensionProgressAdapter.ts";
import { ProgressStatusBarAdapter } from "./progressStatusBarAdapter.ts";

const NOTIFY: IProgressStartOptions = { title: "Indexing", location: "notification", cancellable: true };

describe("ExtensionProgressAdapter", () => {
    let statusBar: StatusBarService;
    let window: ProgressStatusBarAdapter;
    let notifications: NotificationService;
    let adapter: ExtensionProgressAdapter;
    let cancels: number;

    const bar = (): string[] => statusBar.entries().map((e) => e.text.slice(2));
    const toasts = () => notifications.passive();
    const start = (handle: number, options: IProgressStartOptions = NOTIFY): void => {
        adapter.start(handle, options, () => {
            cancels++;
        });
    };

    beforeEach(() => {
        vi.useFakeTimers();
        statusBar = new StatusBarService(NULL_STATE_SERVICE);
        window = new ProgressStatusBarAdapter(statusBar, 100);
        notifications = new NotificationService();
        adapter = new ExtensionProgressAdapter(window, notifications);
        cancels = 0;
    });

    afterEach(() => {
        window.dispose();
        notifications.dispose();
        vi.useRealTimers();
    });

    it.each([
        ["window", "window"],
        ["sourceControl", "sourceControl"],
        ["a view", { viewId: "explorer" }],
    ] as const)("%s goes to the status bar, as before", (_name, location) => {
        start(1, { title: "Build", location, cancellable: true });
        adapter.report(1, "step", 42);

        expect(bar()).toEqual(["Build · step (42%)"]);
        expect(toasts()).toEqual([]);

        adapter.end(1);
        expect(bar()).toEqual([]);
    });

    it("[api:window.withProgress] Notification: a toast with `title: message`, percent summed and clamped", () => {
        start(1);
        expect(toasts()).toEqual([expect.objectContaining({ message: "Indexing", items: ["Cancel"], progress: {} })]);

        adapter.report(1, "src/a.ts", 30);
        adapter.report(1, undefined, 12);
        expect(toasts()[0]).toEqual(
            expect.objectContaining({ message: "Indexing: src/a.ts", progress: { percent: 42 } }),
        );

        adapter.report(1, undefined, 500);
        expect(toasts()[0].progress).toEqual({ percent: 100 });
        adapter.report(1, undefined, -500);
        expect(toasts()[0].progress).toEqual({ percent: 0 });
        expect(bar()).toEqual([]);
    });

    it("without a title only the message; codicons are stripped", () => {
        start(1, { title: "", location: "notification", cancellable: false });
        adapter.report(1, "$(sync~spin) Loading \\$(x)");

        // A message alone leaves the progress infinite.
        expect(toasts()[0]).toEqual(expect.objectContaining({ message: " Loading $(x)", items: [], progress: {} }));
    });

    it("the toast stays at least 800 ms, then goes when the task ended", () => {
        start(1);
        adapter.end(1);
        vi.advanceTimersByTime(PROGRESS_NOTIFICATION_MIN_VISIBLE_MS - 1);
        expect(toasts()).toHaveLength(1);

        vi.advanceTimersByTime(1);
        expect(toasts()).toEqual([]);
    });

    it("a task ending after 800 ms closes the toast at once", () => {
        start(1);
        vi.advanceTimersByTime(PROGRESS_NOTIFICATION_MIN_VISIBLE_MS);
        expect(toasts()).toHaveLength(1);

        adapter.end(1);
        expect(toasts()).toEqual([]);
    });

    it("[api:window.withProgress] Cancel calls back once and leaves no UI behind", () => {
        start(1);
        adapter.report(1, "half", 50);

        notifications.answer(toasts()[0].id, 0);
        adapter.report(1, "still going", 10);

        expect(cancels).toBe(1);
        expect(toasts()).toEqual([]);
        expect(bar()).toEqual([]);
        adapter.end(1);
        expect(bar()).toEqual([]);
    });

    it("hidden (Clear All) while running: the progress moves to the status bar with what it had", () => {
        start(1);
        adapter.report(1, "half", 50);

        notifications.clearAll();
        expect(bar()).toEqual(["Indexing · half (50%)"]);

        adapter.report(1, "more", 10);
        expect(bar()).toEqual(["Indexing · more (60%)"]);
        expect(toasts()).toEqual([]);

        adapter.end(1);
        expect(bar()).toEqual([]);
    });

    it("hidden after a bare increment: the status bar gets the percent", () => {
        start(1);
        adapter.report(1, undefined, 30);

        notifications.clearAll();

        expect(bar()).toEqual(["Indexing (30%)"]);
    });

    it("a report after the task ended does not touch the toast still on screen", () => {
        start(1);
        adapter.end(1);

        adapter.report(1, "late", 10);

        expect(toasts()[0]).toEqual(expect.objectContaining({ message: "Indexing", progress: {} }));
    });

    it("hidden before any report: a bare status bar entry", () => {
        start(1);
        notifications.clearAll();

        expect(bar()).toEqual(["Indexing"]);
    });

    it("hidden after the task ended, during the 800 ms: nothing moves to the status bar", () => {
        start(1);
        adapter.end(1);

        notifications.clearAll();
        vi.advanceTimersByTime(PROGRESS_NOTIFICATION_MIN_VISIBLE_MS);

        expect(bar()).toEqual([]);
        expect(toasts()).toEqual([]);
    });

    it("unknown handles go to the status bar sink, which ignores them", () => {
        adapter.report(5, "x", 1);
        adapter.end(5);

        expect(bar()).toEqual([]);
    });
});
