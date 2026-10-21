import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureNoDisposablesAreLeakedInTestSuite } from "../../../../TestUtils/disposableLeaks.ts";

import { ProgressService } from "./progressService.ts";

const disposables = ensureNoDisposablesAreLeakedInTestSuite();

const VIEW = "workbench.scm.changes";

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void } {
    let resolve!: () => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe("ProgressService", () => {
    let service: ProgressService;

    beforeEach(() => {
        vi.useFakeTimers();
        service = new ProgressService({ delayMs: 300, minVisibleMs: 500, intervalMs: 100 });
    });

    afterEach(() => {
        service.dispose();
        vi.useRealTimers();
    });

    it("an operation shorter than the delay is not shown and does not start the ticker", async () => {
        const task = deferred();
        const running = service.withProgress(
            { location: "view", viewId: VIEW, title: "Committing…" },
            () => task.promise,
        );

        expect(service.isBusy(VIEW)).toBe(true);
        // Scoped too: the neighboring section is free, no reason to disable its buttons.
        expect(service.isBusy("workbench.scm.graph")).toBe(false);
        expect(service.viewProgress().size).toBe(0);

        vi.advanceTimersByTime(200);
        task.resolve();
        await running;

        expect(service.isBusy()).toBe(false);
        vi.advanceTimersByTime(10_000);
        expect(service.viewProgress().size).toBe(0);
    });

    it("after the delay shows a frame, advances it with the ticker and calls listeners on every frame", async () => {
        const listener = vi.fn();
        disposables.add(service.onDidChange(listener));
        const task = deferred();
        const running = service.withProgress(
            { location: "view", viewId: VIEW, title: "Committing…" },
            () => task.promise,
        );

        vi.advanceTimersByTime(300);
        expect(service.viewProgress().get(VIEW)).toEqual({ spinner: "⠋", title: "Committing…" });

        // The frame must not only change but also wake rendering, otherwise
        // the spinner "spins" only in the model.
        listener.mockClear();
        vi.advanceTimersByTime(100);
        expect(service.viewProgress().get(VIEW)?.spinner).toBe("⠙");
        expect(listener).toHaveBeenCalled();

        // A full cycle: the remaining eight frames and back to the first. Listed
        // literally: each SPINNER_FRAMES element is a separate mutant, and a frame
        // missing from the expectations would survive replacement with an empty string.
        for (const frame of ["⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏", "⠋"]) {
            vi.advanceTimersByTime(100);
            expect(service.viewProgress().get(VIEW)?.spinner).toBe(frame);
        }

        task.resolve();
        await running;
        vi.advanceTimersByTime(10_000);
    });

    it("default timings: shown after 300 ms, a frame every 100 ms, shown for at least 500 ms", async () => {
        // The only test without injected timings: otherwise nobody checks the
        // defaults, and changing any of them goes unnoticed.
        const defaults = new ProgressService();
        const task = deferred();
        const running = defaults.withProgress(
            { location: "view", viewId: VIEW, title: "Committing…" },
            () => task.promise,
        );

        vi.advanceTimersByTime(299);
        expect(defaults.viewProgress().size).toBe(0);
        vi.advanceTimersByTime(1);
        expect(defaults.viewProgress().get(VIEW)?.spinner).toBe("⠋");

        vi.advanceTimersByTime(99);
        expect(defaults.viewProgress().get(VIEW)?.spinner).toBe("⠋");
        vi.advanceTimersByTime(1);
        expect(defaults.viewProgress().get(VIEW)?.spinner).toBe("⠙");

        task.resolve();
        await running;
        // Shown at 300, released at 400: stays until 800.
        vi.advanceTimersByTime(399);
        expect(defaults.viewProgress().has(VIEW)).toBe(true);
        vi.advanceTimersByTime(1);
        expect(defaults.viewProgress().has(VIEW)).toBe(false);

        defaults.dispose();
    });

    it("a short operation leaves no pending timers", async () => {
        const listener = vi.fn();
        disposables.add(service.onDidChange(listener));
        const task = deferred();
        const running = service.withProgress({ location: "view", viewId: VIEW, title: "Staging…" }, () => task.promise);

        vi.advanceTimersByTime(200);
        task.resolve();
        await running;

        // The show timer is cleared with the entry: otherwise it fires later and
        // wakes rendering with a spinner for an operation long gone.
        expect(vi.getTimerCount()).toBe(0);
        listener.mockClear();
        vi.advanceTimersByTime(10_000);
        expect(listener).not.toHaveBeenCalled();
    });

    it("the ticker stops after a long operation ends", async () => {
        const listener = vi.fn();
        disposables.add(service.onDidChange(listener));
        const task = deferred();
        const running = service.withProgress({ location: "view", viewId: VIEW, title: "Pushing…" }, () => task.promise);

        // Longer than both the delay AND the minimum visible time: nothing to wait for,
        // so the end of the operation must stop the ticker immediately.
        vi.advanceTimersByTime(1000);
        task.resolve();
        await running;

        expect(service.viewProgress().size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
        listener.mockClear();
        vi.advanceTimersByTime(10_000);
        expect(listener).not.toHaveBeenCalled();
    });

    it("a second shown operation does not start a second ticker", async () => {
        const first = deferred();
        const second = deferred();
        const a = service.withProgress({ location: "view", viewId: VIEW, title: "Committing…" }, () => first.promise);
        vi.advanceTimersByTime(300);
        const b = service.withProgress({ location: "window", title: "Pushing…" }, () => second.promise);
        vi.advanceTimersByTime(300);

        // Exactly three live timers: the shared ticker and the two entries' minVisible timers.
        expect(vi.getTimerCount()).toBe(3);

        first.resolve();
        second.resolve();
        await Promise.all([a, b]);
        vi.advanceTimersByTime(10_000);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("the service is silent after dispose", () => {
        const listener = vi.fn();
        disposables.add(service.onDidChange(listener));
        service.dispose();

        void service.withProgress({ location: "window", title: "Fetching…" }, () => deferred().promise);
        vi.advanceTimersByTime(10_000);
        expect(listener).not.toHaveBeenCalled();
    });

    it("a shown spinner stays for the minimum display time", async () => {
        const task = deferred();
        const running = service.withProgress({ location: "view", viewId: VIEW, title: "Pulling…" }, () => task.promise);

        vi.advanceTimersByTime(350);
        task.resolve();
        await running;

        // The operation ended but the spinner is still visible: 300 + 500 = 800 ms from start.
        expect(service.isBusy(VIEW)).toBe(false);
        expect(service.viewProgress().has(VIEW)).toBe(true);

        vi.advanceTimersByTime(450);
        expect(service.viewProgress().has(VIEW)).toBe(false);
    });

    it("two operations on one section show one spinner with the earliest one's title", async () => {
        const first = deferred();
        const second = deferred();
        const a = service.withProgress({ location: "view", viewId: VIEW, title: "Committing…" }, () => first.promise);
        const b = service.withProgress({ location: "view", viewId: VIEW, title: "Staging…" }, () => second.promise);

        vi.advanceTimersByTime(300);
        expect(service.viewProgress().get(VIEW)?.title).toBe("Committing…");

        first.resolve();
        await a;
        vi.advanceTimersByTime(500);
        expect(service.viewProgress().get(VIEW)?.title).toBe("Staging…");
        expect(service.isBusy(VIEW)).toBe(true);

        second.resolve();
        await b;
        vi.advanceTimersByTime(10_000);
        expect(service.viewProgress().size).toBe(0);
    });

    it("a task error propagates and closes the progress", async () => {
        const task = deferred();
        const running = service.withProgress({ location: "view", viewId: VIEW, title: "Pushing…" }, () => task.promise);

        vi.advanceTimersByTime(300);
        task.reject(new Error("boom"));

        await expect(running).rejects.toThrow("boom");
        expect(service.isBusy()).toBe(false);
    });

    it("the window location is independent of sections", async () => {
        const task = deferred();
        const running = service.withProgress({ location: "window", title: "Fetching…" }, () => task.promise);

        vi.advanceTimersByTime(300);
        expect(service.windowProgress()).toEqual({ spinner: "⠋", title: "Fetching…" });
        expect(service.viewProgress().size).toBe(0);
        expect(service.isBusy(VIEW)).toBe(false);
        expect(service.isBusy()).toBe(true);

        task.resolve();
        await running;
        vi.advanceTimersByTime(10_000);
        expect(service.windowProgress()).toBeNull();
    });

    it("the ticker stops together with the last spinner", async () => {
        const listener = vi.fn();
        disposables.add(service.onDidChange(listener));
        const task = deferred();
        const running = service.withProgress(
            { location: "view", viewId: VIEW, title: "Committing…" },
            () => task.promise,
        );

        vi.advanceTimersByTime(300);
        task.resolve();
        await running;
        vi.advanceTimersByTime(500);

        listener.mockClear();
        vi.advanceTimersByTime(10_000);
        expect(listener).not.toHaveBeenCalled();
    });

    it("the next operation starts from the first frame", async () => {
        const first = deferred();
        const a = service.withProgress({ location: "view", viewId: VIEW, title: "Committing…" }, () => first.promise);
        vi.advanceTimersByTime(500);
        // Shown at 300, ticks at 400 and 500: the third frame.
        expect(service.viewProgress().get(VIEW)?.spinner).toBe("⠹");
        first.resolve();
        await a;
        vi.advanceTimersByTime(10_000);

        const second = deferred();
        const b = service.withProgress({ location: "view", viewId: VIEW, title: "Pulling…" }, () => second.promise);
        vi.advanceTimersByTime(300);
        expect(service.viewProgress().get(VIEW)?.spinner).toBe("⠋");
        second.resolve();
        await b;
        vi.advanceTimersByTime(10_000);
    });

    it("a removed listener is no longer called", () => {
        const listener = vi.fn();
        const subscription = disposables.add(service.onDidChange(listener));
        subscription.dispose();
        void service.withProgress({ location: "window", title: "Fetching…" }, () => deferred().promise);
        expect(listener).not.toHaveBeenCalled();
    });

    it("dispose clears live entries and timers", () => {
        const listener = vi.fn();
        disposables.add(service.onDidChange(listener));
        void service.withProgress({ location: "view", viewId: VIEW, title: "Committing…" }, () => deferred().promise);
        vi.advanceTimersByTime(300);

        service.dispose();
        expect(service.viewProgress().size).toBe(0);
        expect(service.isBusy()).toBe(false);
        expect(vi.getTimerCount()).toBe(0);

        listener.mockClear();
        vi.advanceTimersByTime(10_000);
        expect(listener).not.toHaveBeenCalled();
    });

    it("ending an operation that outlived dispose breaks nothing", async () => {
        const task = deferred();
        const running = service.withProgress(
            { location: "view", viewId: VIEW, title: "Committing…" },
            () => task.promise,
        );
        vi.advanceTimersByTime(300);

        // The app closes mid-operation: the entry is already gone, and the task
        // promise only now reaches finally.
        service.dispose();
        task.resolve();
        await expect(running).resolves.toBeUndefined();
        expect(service.isBusy()).toBe(false);
    });

    it("ending one operation does not stop the ticker while another is spinning", async () => {
        const first = deferred();
        const second = deferred();
        const a = service.withProgress({ location: "view", viewId: VIEW, title: "Committing…" }, () => first.promise);
        const b = service.withProgress({ location: "window", title: "Pushing…" }, () => second.promise);
        vi.advanceTimersByTime(300);

        first.resolve();
        await a;
        const before = service.windowProgress()!.spinner;
        vi.advanceTimersByTime(100);
        expect(service.windowProgress()!.spinner).not.toBe(before);

        second.resolve();
        await b;
        vi.advanceTimersByTime(10_000);
    });

    it("an operation not shown yet does not hold the ticker", async () => {
        const first = deferred();
        const a = service.withProgress({ location: "view", viewId: VIEW, title: "Committing…" }, () => first.promise);
        vi.advanceTimersByTime(300);

        // The second starts near the end of the first and won't be shown yet.
        vi.advanceTimersByTime(400);
        const second = deferred();
        const b = service.withProgress({ location: "window", title: "Pushing…" }, () => second.promise);
        first.resolve();
        await a;

        // The first served its minimum visible time and left: nothing to spin.
        vi.advanceTimersByTime(100);
        expect(service.viewProgress().size).toBe(0);
        expect(service.windowProgress()).toBeNull();

        const listener = vi.fn();
        disposables.add(service.onDidChange(listener));
        vi.advanceTimersByTime(100);
        expect(listener).not.toHaveBeenCalled();

        second.resolve();
        await b;
        vi.advanceTimersByTime(10_000);
    });

    it("a repeated end on a finished operation is a no-op", async () => {
        const task = deferred();
        const running = service.withProgress({ location: "window", title: "Fetching…" }, () => task.promise);
        task.resolve();
        await running;

        const listener = vi.fn();
        disposables.add(service.onDidChange(listener));
        service.dispose();
        vi.advanceTimersByTime(10_000);
        expect(listener).not.toHaveBeenCalled();
    });
});
