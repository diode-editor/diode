import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RunOnceScheduler, runWhenGlobalIdle } from "./async.ts";
import { setUnexpectedErrorHandler } from "./errors.ts";
import { setTimeout0 } from "./platform.ts";

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
        scheduler.schedule(); // rescheduling restarts the countdown
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
            expect(scheduler.isScheduled()).toBe(false); // already cleared when it runs
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
        // dispose clears the timer too, not just releases the function.
        expect(scheduler.isScheduled()).toBe(false);
        vi.advanceTimersByTime(100);
        scheduler.schedule();
        vi.advanceTimersByTime(100);

        expect(runner).not.toHaveBeenCalled();
    });
});

describe("runWhenGlobalIdle", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("зовёт колбэк макрозадачей с бюджетом в один кадр (15 мс), который тает со временем", () => {
        const remaining: number[] = [];
        runWhenGlobalIdle((idle) => {
            expect(idle.didTimeout).toBe(true);
            remaining.push(idle.timeRemaining());
            vi.setSystemTime(Date.now() + 10);
            remaining.push(idle.timeRemaining());
            vi.setSystemTime(Date.now() + 10);
            remaining.push(idle.timeRemaining());
        });
        expect(remaining).toEqual([]);

        vi.runAllTimers();
        expect(remaining).toEqual([15, 5, 0]);
    });

    it("dispose до запуска — колбэк не зовётся", () => {
        const callback = vi.fn();
        runWhenGlobalIdle(callback).dispose();
        vi.runAllTimers();
        expect(callback).not.toHaveBeenCalled();
    });
});

describe("setTimeout0", () => {
    it("исключение колбэка уходит в onUnexpectedError, а не роняет процесс", async () => {
        const errors: unknown[] = [];
        setUnexpectedErrorHandler((e) => errors.push(e));
        try {
            const boom = new Error("boom");
            setTimeout0(() => {
                throw boom;
            });
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(errors).toEqual([boom]);
        } finally {
            setUnexpectedErrorHandler((e) => {
                console.error(e);
            });
        }
    });

    it("ставит колбэк в очередь setImmediate — после текущей задачи и её микрозадач", async () => {
        const order: string[] = [];
        setTimeout0(() => order.push("macrotask"));
        queueMicrotask(() => order.push("microtask"));
        order.push("sync");
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(order).toEqual(["sync", "microtask", "macrotask"]);
    });
});
