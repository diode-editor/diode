import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProgressService } from "./progressService.ts";

const VIEW = "workbench.scm.changes";

/** Управляемая задача: прогресс живёт, пока не позвали resolve/reject. */
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
        const running = service.withProgress({ location: "view", viewId: VIEW, title: "Committing…" }, () => task.promise);

        // Занятость видна сразу — кнопки гаснут без задержки.
        expect(service.isBusy(VIEW)).toBe(true);
        expect(service.viewProgress().size).toBe(0);

        vi.advanceTimersByTime(200);
        task.resolve();
        await running;

        expect(service.isBusy()).toBe(false);
        vi.advanceTimersByTime(10_000);
        expect(service.viewProgress().size).toBe(0);
    });

    it("после задержки показывает кадр и крутит его тикером", async () => {
        const task = deferred();
        const running = service.withProgress({ location: "view", viewId: VIEW, title: "Committing…" }, () => task.promise);

        vi.advanceTimersByTime(300);
        expect(service.viewProgress().get(VIEW)).toEqual({ spinner: "◐", title: "Committing…" });

        vi.advanceTimersByTime(100);
        expect(service.viewProgress().get(VIEW)?.spinner).toBe("◓");

        task.resolve();
        await running;
        vi.advanceTimersByTime(10_000);
    });

    it("показанный спиннер досиживает минимум показа", async () => {
        const task = deferred();
        const running = service.withProgress({ location: "view", viewId: VIEW, title: "Pulling…" }, () => task.promise);

        vi.advanceTimersByTime(350);
        task.resolve();
        await running;

        // Операция кончилась, но спиннер ещё виден: 300 + 500 = 800 мс от старта.
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
        // Первая ушла — осталась вторая, подпись сменилась.
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
        expect(service.windowProgress()).toEqual({ spinner: "◐", title: "Fetching…" });
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
        service.onDidChange(listener);
        const task = deferred();
        const running = service.withProgress({ location: "view", viewId: VIEW, title: "Committing…" }, () => task.promise);

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
        // Показ на 300-й, тики на 400-й и 500-й — третий кадр.
        expect(service.viewProgress().get(VIEW)?.spinner).toBe("◑");
        first.resolve();
        await a;
        vi.advanceTimersByTime(10_000);

        const second = deferred();
        const b = service.withProgress({ location: "view", viewId: VIEW, title: "Pulling…" }, () => second.promise);
        vi.advanceTimersByTime(300);
        expect(service.viewProgress().get(VIEW)?.spinner).toBe("◐");
        second.resolve();
        await b;
        vi.advanceTimersByTime(10_000);
    });

    it("снятый слушатель больше не зовётся", () => {
        const listener = vi.fn();
        const subscription = service.onDidChange(listener);
        subscription.dispose();
        void service.withProgress({ location: "window", title: "Fetching…" }, () => deferred().promise);
        expect(listener).not.toHaveBeenCalled();
    });

    it("dispose гасит живые записи и таймеры", () => {
        const listener = vi.fn();
        service.onDidChange(listener);
        void service.withProgress({ location: "view", viewId: VIEW, title: "Committing…" }, () => deferred().promise);
        vi.advanceTimersByTime(300);

        service.dispose();
        expect(service.viewProgress().size).toBe(0);
        expect(service.isBusy()).toBe(false);

        listener.mockClear();
        vi.advanceTimersByTime(10_000);
        expect(listener).not.toHaveBeenCalled();
    });

    it("конец операции, пережившей dispose, ничего не ломает", async () => {
        const task = deferred();
        const running = service.withProgress({ location: "view", viewId: VIEW, title: "Committing…" }, () => task.promise);
        vi.advanceTimersByTime(300);

        // Приложение закрывается посреди операции: запись уже снята, а промис
        // задачи только сейчас доехал до finally.
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
        // Кадр второй операции обязан продолжать меняться.
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

        // Вторая стартовала под конец первой и показаться ещё не успеет.
        vi.advanceTimersByTime(400);
        const second = deferred();
        const b = service.withProgress({ location: "window", title: "Pushing…" }, () => second.promise);
        first.resolve();
        await a;

        // Первая досидела минимум показа и ушла — крутить стало нечего.
        vi.advanceTimersByTime(100);
        expect(service.viewProgress().size).toBe(0);
        expect(service.windowProgress()).toBeNull();

        const listener = vi.fn();
        service.onDidChange(listener);
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
        service.onDidChange(listener);
        service.dispose();
        vi.advanceTimersByTime(10_000);
        expect(listener).not.toHaveBeenCalled();
    });
});
