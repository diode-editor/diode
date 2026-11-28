import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MARK_INACTIVE_DEBOUNCE, PROGRESS_ACTIVITY_HOLD, UserActivityService } from "./userActivityService.ts";

function setup() {
    const service = new UserActivityService();
    const events: boolean[] = [];
    service.onDidChangeIsActive((active) => events.push(active));
    return { service, events };
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("UserActivityService", () => {
    it("starts active: the user just opened the window", () => {
        expect(new UserActivityService().isActive).toBe(true);
    });

    it("goes inactive MARK_INACTIVE_DEBOUNCE after the last hold is released", () => {
        const { service, events } = setup();
        const first = service.markActive();
        const second = service.markActive();
        expect(events).toStrictEqual([true]);
        first.dispose();
        vi.advanceTimersByTime(MARK_INACTIVE_DEBOUNCE * 2);
        expect(service.isActive).toBe(true);
        second.dispose();
        vi.advanceTimersByTime(MARK_INACTIVE_DEBOUNCE - 1);
        expect(service.isActive).toBe(true);
        vi.advanceTimersByTime(1);
        expect(service.isActive).toBe(false);
        expect(events).toStrictEqual([true, false]);
    });

    it("a new hold within the debounce keeps it active", () => {
        const { service, events } = setup();
        service.markActive().dispose();
        vi.advanceTimersByTime(MARK_INACTIVE_DEBOUNCE - 1);
        service.markActive();
        vi.advanceTimersByTime(MARK_INACTIVE_DEBOUNCE * 2);
        expect(service.isActive).toBe(true);
        expect(events).toStrictEqual([true, true]);
    });

    it("a hold after inactivity makes it active again at once", () => {
        const { service, events } = setup();
        service.markActive().dispose();
        vi.advanceTimersByTime(MARK_INACTIVE_DEBOUNCE);
        service.markActive();
        expect(service.isActive).toBe(true);
        expect(events).toStrictEqual([true, false, true]);
    });

    it("whenHeldFor counts the hold only once it has lasted that long", () => {
        const { service, events } = setup();
        const hold = service.markActive({ whenHeldFor: 1000 });
        vi.advanceTimersByTime(999);
        expect(events).toStrictEqual([]);
        vi.advanceTimersByTime(1);
        expect(events).toStrictEqual([true]);
        hold.dispose();
        vi.advanceTimersByTime(MARK_INACTIVE_DEBOUNCE);
        expect(events).toStrictEqual([true, false]);
    });

    it("whenHeldFor disposed early never counts", () => {
        const { service, events } = setup();
        service.markActive({ whenHeldFor: 1000 }).dispose();
        vi.advanceTimersByTime(MARK_INACTIVE_DEBOUNCE * 2);
        expect(events).toStrictEqual([]);
    });

    it("extendOnly does not wake an inactive user — a long progress extends, never starts", () => {
        const { service, events } = setup();
        service.markActive().dispose();
        vi.advanceTimersByTime(MARK_INACTIVE_DEBOUNCE);
        service.markActive(PROGRESS_ACTIVITY_HOLD);
        vi.advanceTimersByTime(60_000);
        expect(service.isActive).toBe(false);
        expect(events).toStrictEqual([true, false]);
    });

    it("a long progress keeps an active user active past the debounce", () => {
        const { service } = setup();
        const input = service.markActive();
        const progress = service.markActive(PROGRESS_ACTIVITY_HOLD);
        vi.advanceTimersByTime(15_000);
        input.dispose();
        vi.advanceTimersByTime(60_000);
        expect(service.isActive).toBe(true);
        progress.dispose();
        vi.advanceTimersByTime(MARK_INACTIVE_DEBOUNCE);
        expect(service.isActive).toBe(false);
    });
});
