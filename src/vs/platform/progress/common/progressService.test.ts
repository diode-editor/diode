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

    it("операция короче задержки не показывается и не заводит тикер", async () => {
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

    it("после задержки показывает кадр, крутит его тикером и зовёт слушателей на каждый кадр", async () => {
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

    it("дефолтные тайминги: показ через 300 мс, кадр каждые 100 мс, минимум показа 500 мс", async () => {
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

    it("короткая операция не оставляет висящих таймеров", async () => {
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

    it("после конца долгой операции тикер останавливается", async () => {
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

    it("вторая показанная операция не заводит второй тикер", async () => {
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

    it("после dispose сервис молчит", () => {
        const listener = vi.fn();
        disposables.add(service.onDidChange(listener));
        service.dispose();

        void service.withProgress({ location: "window", title: "Fetching…" }, () => deferred().promise);
        vi.advanceTimersByTime(10_000);
        expect(listener).not.toHaveBeenCalled();
    });

    it("показанный спиннер досиживает минимум показа", async () => {
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

    it("две операции на одну секцию — один спиннер с подписью самой ранней", async () => {
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

    it("ошибка задачи пробрасывается наружу и закрывает прогресс", async () => {
        const task = deferred();
        const running = service.withProgress({ location: "view", viewId: VIEW, title: "Pushing…" }, () => task.promise);

        vi.advanceTimersByTime(300);
        task.reject(new Error("boom"));

        await expect(running).rejects.toThrow("boom");
        expect(service.isBusy()).toBe(false);
    });

    it("window-локация независима от секций", async () => {
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

    it("тикер гаснет вместе с последним спиннером", async () => {
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

    it("следующая операция начинает с первого кадра", async () => {
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

    it("снятый слушатель больше не зовётся", () => {
        const listener = vi.fn();
        const subscription = disposables.add(service.onDidChange(listener));
        subscription.dispose();
        void service.withProgress({ location: "window", title: "Fetching…" }, () => deferred().promise);
        expect(listener).not.toHaveBeenCalled();
    });

    it("dispose гасит живые записи и таймеры", () => {
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

    it("конец операции, пережившей dispose, ничего не ломает", async () => {
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

    it("конец одной операции не гасит тикер, пока крутится другая", async () => {
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

    it("ещё не показанная операция тикер не держит", async () => {
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

    it("повторный end по завершённой операции — no-op", async () => {
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
