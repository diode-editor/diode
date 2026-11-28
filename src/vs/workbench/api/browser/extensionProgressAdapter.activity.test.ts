import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NULL_STATE_SERVICE } from "../../../platform/state/common/nullStateService.ts";
import { NotificationService } from "../../services/notification/browser/notificationService.ts";
import { StatusBarService } from "../../services/statusbar/common/statusBarService.ts";
import {
    MARK_INACTIVE_DEBOUNCE,
    PROGRESS_ACTIVITY_HOLD,
    UserActivityService,
} from "../../services/userActivity/common/userActivityService.ts";

import { ExtensionProgressAdapter } from "./extensionProgressAdapter.ts";
import { ProgressStatusBarAdapter } from "./progressStatusBarAdapter.ts";

const HELD_FOR = PROGRESS_ACTIVITY_HOLD.whenHeldFor ?? 0;

describe("ExtensionProgressAdapter — a long extension progress extends the user's activity", () => {
    let notifications: NotificationService;
    let window: ProgressStatusBarAdapter;
    let activity: UserActivityService;
    let adapter: ExtensionProgressAdapter;

    beforeEach(() => {
        vi.useFakeTimers();
        notifications = new NotificationService();
        window = new ProgressStatusBarAdapter(new StatusBarService(NULL_STATE_SERVICE), 100);
        activity = new UserActivityService();
        adapter = new ExtensionProgressAdapter(
            window,
            notifications,
            { start: () => undefined, end: () => undefined },
            activity,
        );
    });

    afterEach(() => {
        window.dispose();
        notifications.dispose();
        vi.useRealTimers();
    });

    it.each(["window", "notification", "sourceControl"] as const)(
        "%s: held past %s ms, the user stays active until the task ends",
        (location) => {
            const input = activity.markActive();
            adapter.start(1, { title: "Indexing", location, cancellable: false }, () => undefined);
            vi.advanceTimersByTime(HELD_FOR);
            input.dispose();
            vi.advanceTimersByTime(MARK_INACTIVE_DEBOUNCE * 6);
            expect(activity.isActive).toBe(true);
            adapter.end(1);
            vi.advanceTimersByTime(MARK_INACTIVE_DEBOUNCE);
            expect(activity.isActive).toBe(false);
        },
    );

    it("a short task does not hold, and a task never wakes an inactive user", () => {
        const input = activity.markActive();
        adapter.start(1, { title: "Quick", location: "window", cancellable: false }, () => undefined);
        input.dispose();
        adapter.end(1);
        vi.advanceTimersByTime(MARK_INACTIVE_DEBOUNCE);
        expect(activity.isActive).toBe(false);
        adapter.start(2, { title: "Background", location: "window", cancellable: false }, () => undefined);
        vi.advanceTimersByTime(HELD_FOR * 2);
        expect(activity.isActive).toBe(false);
        adapter.end(2);
    });
});
