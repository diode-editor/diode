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
        // И адресно: соседняя секция свободна, её кнопки гасить не за что.
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
        service.onDidChange(listener);
        const task = deferred();
        const running = service.withProgress({ location: "view", viewId: VIEW, title: "Committing…" }, () => task.promise);

        vi.advanceTimersByTime(300);
        expect(service.viewProgress().get(VIEW)).toEqual({ spinner: "⠋", title: "Committing…" });

        // Кадр обязан не только смениться, но и разбудить отрисовку — иначе
        // спиннер «крутится» только в модели.
        listener.mockClear();
        vi.advanceTimersByTime(100);
        expect(service.viewProgress().get(VIEW)?.spinner).toBe("⠙");
        expect(listener).toHaveBeenCalled();

        // Полный оборот: остальные восемь кадров и возврат к первому. Перечислены
        // дословно — каждый элемент SPINNER_FRAMES это отдельный мутант, и кадр,
        // которого нет в ожиданиях, подмену на пустую строку переживёт.
        for (const frame of ["⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏", "⠋"]) {
            vi.advanceTimersByTime(100);
            expect(service.viewProgress().get(VIEW)?.spinner).toBe(frame);
        }

        task.resolve();
        await running;
        vi.advanceTimersByTime(10_000);
    });

    it("дефолтные тайминги: показ через 300 мс, кадр каждые 100 мс, минимум показа 500 мс", async () => {
        // Единственный тест без инжекции таймингов — иначе дефолты не проверяет
        // никто, и подмена любого из них проходит незамеченной.
        const defaults = new ProgressService();
        const task = deferred();
        const running = defaults.withProgress({ location: "view", viewId: VIEW, title: "Committing…" }, () => task.promise);

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
        // Показали на 300-й, отпустили на 400-й — досиживает до 800-й.
        vi.advanceTimersByTime(399);
        expect(defaults.viewProgress().has(VIEW)).toBe(true);
        vi.advanceTimersByTime(1);
        expect(defaults.viewProgress().has(VIEW)).toBe(false);

        defaults.dispose();
    });

    it("короткая операция не оставляет висящих таймеров", async () => {
        const listener = vi.fn();
        service.onDidChange(listener);
        const task = deferred();
        const running = service.withProgress({ location: "view", viewId: VIEW, title: "Staging…" }, () => task.promise);

        vi.advanceTimersByTime(200);
        task.resolve();
        await running;

        // Таймер показа снят вместе с записью: иначе он выстрелит позже и
        // разбудит отрисовку спиннером операции, которой давно нет.
        expect(vi.getTimerCount()).toBe(0);
        listener.mockClear();
        vi.advanceTimersByTime(10_000);
        expect(listener).not.toHaveBeenCalled();
    });

    it("после конца долгой операции тикер останавливается", async () => {
        const listener = vi.fn();
        service.onDidChange(listener);
        const task = deferred();
        const running = service.withProgress({ location: "view", viewId: VIEW, title: "Pushing…" }, () => task.promise);

        // Дольше задержки И минимума показа: запись досиживать нечего, конец
        // операции обязан погасить тикер сразу.
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

        // Живых таймеров ровно три: общий тикер и два minVisible'а записей.
        expect(vi.getTimerCount()).toBe(3);

        first.resolve();
        second.resolve();
        await Promise.all([a, b]);
        vi.advanceTimersByTime(10_000);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("после dispose сервис молчит", () => {
        const listener = vi.fn();
        service.onDidChange(listener);
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
        // Ни тикера, ни таймеров записи: приложение закрылось — крутить нечего.
        expect(vi.getTimerCount()).toBe(0);

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
