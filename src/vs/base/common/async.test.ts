import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RunOnceScheduler } from "./async.ts";

describe("RunOnceScheduler", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("запускает функцию один раз через задержку после последнего schedule", () => {
        const runner = vi.fn();
        const scheduler = new RunOnceScheduler(runner, 100);

        scheduler.schedule();
        vi.advanceTimersByTime(60);
        scheduler.schedule(); // перезавод: отсчёт заново
        vi.advanceTimersByTime(60);
        expect(runner).not.toHaveBeenCalled();

        vi.advanceTimersByTime(40);
        expect(runner).toHaveBeenCalledOnce();

        vi.advanceTimersByTime(1000);
        expect(runner).toHaveBeenCalledOnce();
    });

    it("schedule(delay) берёт свою задержку вместо заданной в конструкторе", () => {
        const runner = vi.fn();
        const scheduler = new RunOnceScheduler(runner, 100);

        scheduler.schedule(0);
        vi.advanceTimersByTime(0);

        expect(runner).toHaveBeenCalledOnce();
    });

    it("isScheduled горит от schedule до запуска или отмены", () => {
        const scheduler = new RunOnceScheduler(() => {
            expect(scheduler.isScheduled()).toBe(false); // в момент запуска уже погашен
        }, 10);
        expect(scheduler.isScheduled()).toBe(false);

        scheduler.schedule();
        expect(scheduler.isScheduled()).toBe(true);
        vi.advanceTimersByTime(10);
        expect(scheduler.isScheduled()).toBe(false);

        scheduler.schedule();
        scheduler.cancel();
        expect(scheduler.isScheduled()).toBe(false);
    });

    it("cancel снимает запуск; повторный и холостой cancel безвредны", () => {
        const runner = vi.fn();
        const scheduler = new RunOnceScheduler(runner, 10);
        scheduler.cancel();

        scheduler.schedule();
        scheduler.cancel();
        scheduler.cancel();
        vi.advanceTimersByTime(100);

        expect(runner).not.toHaveBeenCalled();
    });

    it("после dispose функция не выполняется — ни запланированная, ни новая", () => {
        const runner = vi.fn();
        const scheduler = new RunOnceScheduler(runner, 10);

        scheduler.schedule();
        scheduler.dispose();
        // dispose снимает и таймер, а не только отпускает функцию.
        expect(scheduler.isScheduled()).toBe(false);
        vi.advanceTimersByTime(100);
        scheduler.schedule();
        vi.advanceTimersByTime(100);

        expect(runner).not.toHaveBeenCalled();
    });
});
