import { afterEach, describe, expect, it, vi } from "vitest";

import { flushMicrotasks, settle } from "./timing.ts";

describe("flushMicrotasks", () => {
    it("flushes a chain of three microtask turns (default)", async () => {
        let done = false;
        void Promise.resolve()
            .then(() => undefined)
            .then(() => undefined)
            .then(() => {
                done = true;
            });
        await flushMicrotasks();
        expect(done).toBe(true);
    });

    it("honors a custom number of turns", async () => {
        let done = false;
        void Promise.resolve().then(() => {
            done = true;
        });
        await flushMicrotasks(1);
        expect(done).toBe(true);
    });
});

describe("settle", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("resolves after the default 200ms", async () => {
        vi.useFakeTimers();
        let done = false;
        void settle().then(() => {
            done = true;
        });
        await vi.advanceTimersByTimeAsync(199);
        expect(done).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(done).toBe(true);
    });

    it("honors a custom delay", async () => {
        vi.useFakeTimers();
        let done = false;
        void settle(50).then(() => {
            done = true;
        });
        await vi.advanceTimersByTimeAsync(50);
        expect(done).toBe(true);
    });
});
