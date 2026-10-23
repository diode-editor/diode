import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdjustableClock } from "./clock.ts";

describe("AdjustableClock", () => {
    beforeEach(() => {
        vi.useFakeTimers({ now: 1_000_000 });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("tells real time until moved", () => {
        const clock = new AdjustableClock();
        expect(clock.now()).toBe(1_000_000);
        vi.advanceTimersByTime(500);
        expect(clock.now()).toBe(1_000_500);
    });

    it("fires a timer after its delay of real time", () => {
        const clock = new AdjustableClock();
        const fired = vi.fn();
        clock.setTimeout(fired, 1000);
        vi.advanceTimersByTime(999);
        expect(fired).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(fired).toHaveBeenCalledTimes(1);
    });

    it("a disposed timer never fires", () => {
        const clock = new AdjustableClock();
        const fired = vi.fn();
        clock.setTimeout(fired, 1000).dispose();
        vi.advanceTimersByTime(2000);
        expect(fired).not.toHaveBeenCalled();
    });

    it("moving the clock shifts now and fires the timers it passed right away", () => {
        const clock = new AdjustableClock();
        const passed = vi.fn();
        const later = vi.fn();
        clock.setTimeout(passed, 10_000);
        clock.setTimeout(later, 60_000);
        clock.advance(30_000);
        expect(clock.now()).toBe(1_030_000);
        expect(passed).not.toHaveBeenCalled();
        vi.advanceTimersByTime(0);
        expect(passed).toHaveBeenCalledTimes(1);
        expect(later).not.toHaveBeenCalled();
        // The rest of its delay is moved time, not the original one.
        vi.advanceTimersByTime(29_999);
        expect(later).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(later).toHaveBeenCalledTimes(1);
        // The handle armed before the move is gone: no second call at the original real-time deadline.
        vi.advanceTimersByTime(60_000);
        expect(later).toHaveBeenCalledTimes(1);
        expect(passed).toHaveBeenCalledTimes(1);
    });

    it("a zero move changes nothing", () => {
        const clock = new AdjustableClock();
        clock.advance(0);
        expect(clock.now()).toBe(1_000_000);
    });

    it("a timer set after a move counts from the moved time", () => {
        const clock = new AdjustableClock();
        clock.advance(5000);
        const fired = vi.fn();
        clock.setTimeout(fired, 1000);
        vi.advanceTimersByTime(999);
        expect(fired).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(fired).toHaveBeenCalledTimes(1);
    });

    it("a fired or disposed timer is not rescheduled by a later move", () => {
        const clock = new AdjustableClock();
        const fired = vi.fn();
        const disposed = vi.fn();
        clock.setTimeout(fired, 10);
        clock.setTimeout(disposed, 10_000).dispose();
        vi.advanceTimersByTime(10);
        clock.advance(20_000);
        vi.advanceTimersByTime(0);
        expect(fired).toHaveBeenCalledTimes(1);
        expect(disposed).not.toHaveBeenCalled();
    });

    it("rejects a backward move", () => {
        const clock = new AdjustableClock();
        expect(() => {
            clock.advance(-1);
        }).toThrow("The clock only moves forward");
    });
});
