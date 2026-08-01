import { describe, expect, it } from "vitest";

import { type IdleClock, type IdleSource, waitForIdle } from "./idleWaiter.ts";

/** Виртуальные часы: `sleep(ms)` двигает время вперёд, `now()` его читает. */
function fakeClock(): IdleClock & { time(): number } {
    let t = 0;
    return {
        now: () => t,
        sleep: (ms) => {
            t += ms;
            return Promise.resolve();
        },
        time: () => t,
    };
}

/**
 * Источник, у которого кадр «прибывает» по расписанию виртуального времени:
 * `bumps` — моменты (в мс), когда frameCount увеличивается. `scheduledUntil` —
 * до какого времени `isRenderScheduled` держит true.
 */
function scriptedSource(
    clock: { now(): number },
    opts: { bumps?: number[]; scheduledUntil?: number } = {},
): IdleSource {
    const bumps = [...(opts.bumps ?? [])].sort((a, b) => a - b);
    const scheduledUntil = opts.scheduledUntil ?? -1;
    return {
        frameCount: () => bumps.filter((at) => at <= clock.now()).length,
        isRenderScheduled: () => clock.now() < scheduledUntil,
    };
}

describe("waitForIdle", () => {
    it("возвращает idle, когда кадр не меняется quietMs", async () => {
        const clock = fakeClock();
        const source = scriptedSource(clock); // ни одного bump — сразу тихо
        const result = await waitForIdle(source, { quietMs: 40, pollMs: 10, timeoutMs: 1000, clock });
        expect(result.idle).toBe(true);
        expect(result.frames).toBe(0);
        // Не крутились дольше, чем нужно на quietMs.
        expect(clock.time()).toBeLessThan(100);
    });

    it("сбрасывает тишину при каждом новом кадре и дожидается финального покоя", async () => {
        const clock = fakeClock();
        // Кадры на 10, 30, 55 мс — каждый двигает окно тишины.
        const source = scriptedSource(clock, { bumps: [10, 30, 55] });
        const result = await waitForIdle(source, { quietMs: 40, pollMs: 10, timeoutMs: 1000, clock });
        expect(result.idle).toBe(true);
        expect(result.frames).toBe(3);
        // Последний кадр на 55 → тишина минимум до ~95.
        expect(clock.time()).toBeGreaterThanOrEqual(95);
    });

    it("держит busy, пока isRenderScheduled, даже без новых кадров", async () => {
        const clock = fakeClock();
        const source = scriptedSource(clock, { scheduledUntil: 60 });
        const result = await waitForIdle(source, { quietMs: 40, pollMs: 10, timeoutMs: 1000, clock });
        expect(result.idle).toBe(true);
        // Последний busy-опрос — на 50 (на 60 scheduled уже false) → тишина к 90.
        expect(clock.time()).toBeGreaterThanOrEqual(90);
    });

    it("возвращает idle:false по таймауту, если рендер не унимается", async () => {
        const clock = fakeClock();
        const source = scriptedSource(clock, { scheduledUntil: Number.MAX_SAFE_INTEGER });
        const result = await waitForIdle(source, { quietMs: 40, pollMs: 10, timeoutMs: 100, clock });
        expect(result.idle).toBe(false);
        expect(clock.time()).toBeGreaterThanOrEqual(100);
    });

    it("работает с дефолтными опциями и реальными часами", async () => {
        // Тихий источник + маленький реальный таймаут: дефолтные quietMs/pollMs/clock.
        const source: IdleSource = { frameCount: () => 7, isRenderScheduled: () => false };
        const result = await waitForIdle(source);
        expect(result).toEqual({ idle: true, frames: 7 });
    });
});
