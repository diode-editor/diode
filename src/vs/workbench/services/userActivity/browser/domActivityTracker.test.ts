import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { MouseAction, MouseButton } from "@tuidom/core/input/rawTerminalToken";
import { ButtonElement } from "@tuidom/elements/button/buttonElement";
import { TestApp } from "@tuidom/testing/TestApp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MARK_INACTIVE_DEBOUNCE, UserActivityService } from "../common/userActivityService.ts";

import { CHECK_INTERVAL, DomActivityTracker } from "./domActivityTracker.ts";

/** Longest quiet stretch before the tracker lets go: (MIN_INTERVALS_WITHOUT_ACTIVITY + 1) intervals. */
const TRACKER_RELEASE = CHECK_INTERVAL * 3;

function mouse(app: TestApp, action: MouseAction, button: MouseButton): void {
    app.backend.simulateMouse({
        kind: "mouse",
        button,
        action,
        x: 2,
        y: 2,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
    });
}

function setup() {
    const target = new ButtonElement("target");
    const app = TestApp.createWithContent(target);
    app.render();
    target.focus();
    const service = new UserActivityService();
    const events: boolean[] = [];
    service.onDidChangeIsActive((active) => events.push(active));
    const tracker = new DomActivityTracker(app.root, service);
    // Swallows everything in the target phase: the tracker still sees it on the way down.
    target.addEventListener("keydown", (e) => {
        e.stopPropagation();
    });
    return { app, target, service, tracker, events };
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("DomActivityTracker", () => {
    it("a user who walks away goes inactive after 60–90 s of no input plus the debounce, not before", () => {
        const { service, events } = setup();
        vi.advanceTimersByTime(CHECK_INTERVAL * 2 + MARK_INACTIVE_DEBOUNCE - 1);
        expect(service.isActive).toBe(true);
        vi.advanceTimersByTime(TRACKER_RELEASE);
        expect(service.isActive).toBe(false);
        expect(events.at(-1)).toBe(false);
    });

    it("input keeps the user active, and the first key after inactivity brings them back at once", () => {
        const { app, service, events } = setup();
        for (let i = 0; i < 6; i++) {
            vi.advanceTimersByTime(CHECK_INTERVAL);
            app.sendKey("a");
        }
        expect(service.isActive).toBe(true);
        vi.advanceTimersByTime(TRACKER_RELEASE + MARK_INACTIVE_DEBOUNCE);
        expect(service.isActive).toBe(false);
        events.length = 0;
        app.sendKey("a");
        expect(service.isActive).toBe(true);
        expect(events).toStrictEqual([true]);
    });

    it("a click counts; the wheel does not", () => {
        const { app, service } = setup();
        vi.advanceTimersByTime(TRACKER_RELEASE + MARK_INACTIVE_DEBOUNCE);
        mouse(app, "scroll-down", "none");
        expect(service.isActive).toBe(false);
        mouse(app, "press", "left");
        expect(service.isActive).toBe(true);
    });

    it("a focus report is not input", () => {
        const { app, service } = setup();
        vi.advanceTimersByTime(TRACKER_RELEASE + MARK_INACTIVE_DEBOUNCE);
        app.backend.sendFocus(true);
        expect(service.isActive).toBe(false);
    });

    it("after dispose it neither listens nor holds", () => {
        const { app, service, tracker } = setup();
        tracker.dispose();
        vi.advanceTimersByTime(MARK_INACTIVE_DEBOUNCE);
        expect(service.isActive).toBe(false);
        app.root.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "a", code: "KeyA" }));
        expect(service.isActive).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });
});
