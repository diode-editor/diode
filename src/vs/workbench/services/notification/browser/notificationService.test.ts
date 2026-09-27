import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type INotificationMessage, NOTIFICATION_AUTO_HIDE_MS, NotificationService } from "./notificationService.ts";

function message(patch: Partial<INotificationMessage> = {}): INotificationMessage {
    return { severity: "info", message: "hello", modal: false, items: [], ...patch };
}

describe("NotificationService — сообщения без кнопок", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("резолвится СРАЗУ и остаётся видимым: ожидание закрытия подвесило бы расширение", async () => {
        const service = new NotificationService();
        const handle = service.show(message({ severity: "error", message: "boom" }));

        await expect(handle.answered).resolves.toBeUndefined();
        expect(service.passive().map((n) => n.message)).toEqual(["boom"]);
        expect(service.current()).toBeNull();
    });

    it("info гаснет сам через NOTIFICATION_AUTO_HIDE_MS", () => {
        const service = new NotificationService();
        service.show(message({ message: "formatted" }));

        vi.advanceTimersByTime(NOTIFICATION_AUTO_HIDE_MS - 1);
        expect(service.passive()).toHaveLength(1);

        vi.advanceTimersByTime(1);
        expect(service.passive()).toEqual([]);
    });

    it("warning гаснет сам, а error висит до закрытия", () => {
        const service = new NotificationService();
        service.show(message({ severity: "warn", message: "careful" }));
        service.show(message({ severity: "error", message: "boom" }));

        vi.advanceTimersByTime(NOTIFICATION_AUTO_HIDE_MS * 10);
        expect(service.passive().map((n) => n.message)).toEqual(["boom"]);
    });

    it("порядок — от старого к новому (стек рисуется сверху вниз)", () => {
        const service = new NotificationService();
        service.show(message({ message: "one" }));
        service.show(message({ message: "two" }));

        expect(service.passive().map((n) => n.message)).toEqual(["one", "two"]);
    });

    it("dismiss снимает тост и гасит его таймер", () => {
        const service = new NotificationService();
        const handle = service.show(message());
        service.dismiss(handle.id);
        expect(service.passive()).toEqual([]);

        // Повторный dismiss и выстрел снятого таймера ничего не ломают.
        service.dismiss(handle.id);
        vi.advanceTimersByTime(NOTIFICATION_AUTO_HIDE_MS * 2);
        expect(service.passive()).toEqual([]);
    });

    it("dispose снимает таймеры: они не стреляют в мёртвый сервис", () => {
        const service = new NotificationService();
        service.show(message());
        service.dispose();

        vi.advanceTimersByTime(NOTIFICATION_AUTO_HIDE_MS * 2);
        expect(service.passive()).toEqual([]);
        expect(service.isEmpty()).toBe(true);
    });

    it("подписчик получает событие на показ и на гашение", () => {
        const service = new NotificationService();
        const seen = vi.fn();
        service.onDidChange(seen);

        const handle = service.show(message());
        expect(seen).toHaveBeenCalledTimes(1);

        service.dismiss(handle.id);
        expect(seen).toHaveBeenCalledTimes(2);
    });

    it("отписка перестаёт получать события", () => {
        const service = new NotificationService();
        const seen = vi.fn();
        const subscription = service.onDidChange(seen);
        subscription.dispose();

        service.show(message());
        expect(seen).not.toHaveBeenCalled();
    });
});

describe("NotificationService — вопросы", () => {
    it("сообщение с кнопками ждёт ответа и отдаёт индекс нажатой", async () => {
        const service = new NotificationService();
        const handle = service.show(message({ items: ["Activate", "Free"] }));

        expect(service.current()?.message).toBe("hello");
        expect(service.passive()).toEqual([]);

        service.answer(handle.id, 1);
        await expect(handle.answered).resolves.toBe(1);
        expect(service.current()).toBeNull();
    });

    it("закрытие без выбора отдаёт undefined", async () => {
        const service = new NotificationService();
        const handle = service.show(message({ items: ["One"] }));

        service.dismiss(handle.id);
        await expect(handle.answered).resolves.toBeUndefined();
    });

    it("индекс вне набора кнопок — это не ответ, а закрытие", async () => {
        const service = new NotificationService();
        const handle = service.show(message({ items: ["One"] }));

        service.answer(handle.id, 5);
        await expect(handle.answered).resolves.toBeUndefined();
    });

    it("отрицательный индекс — тоже закрытие", async () => {
        const service = new NotificationService();
        const handle = service.show(message({ items: ["One"] }));

        service.answer(handle.id, -1);
        await expect(handle.answered).resolves.toBeUndefined();
    });

    it("вопросы показываются по одному: второй ждёт ответа на первый", async () => {
        const service = new NotificationService();
        const first = service.show(message({ message: "first", items: ["One"] }));
        const second = service.show(message({ message: "second", items: ["Two"] }));

        expect(service.current()?.message).toBe("first");
        expect(service.queuedCount()).toBe(1);

        service.answer(first.id, 0);
        await expect(first.answered).resolves.toBe(0);
        expect(service.current()?.message).toBe("second");
        expect(service.queuedCount()).toBe(0);

        service.answer(second.id, 0);
        await expect(second.answered).resolves.toBe(0);
    });

    it("ответ на вопрос из очереди доходит, не дожидаясь своего показа", async () => {
        const service = new NotificationService();
        service.show(message({ message: "first", items: ["One"] }));
        const queued = service.show(message({ message: "second", items: ["Two"] }));

        service.answer(queued.id, 0);
        await expect(queued.answered).resolves.toBe(0);
        // Первый по-прежнему на экране — снятие второго его не тронуло.
        expect(service.current()?.message).toBe("first");
    });

    it("ответ на незнакомый id — no-op", async () => {
        const service = new NotificationService();
        const handle = service.show(message({ items: ["One"] }));

        service.answer(handle.id + 100, 0);
        expect(service.current()?.id).toBe(handle.id);
    });

    it("модальное сообщение идёт без очереди — иначе его могли бы не заметить", () => {
        const service = new NotificationService();
        service.show(message({ message: "toast question", items: ["One"] }));
        service.show(message({ message: "modal", modal: true, items: ["Delete"] }));

        expect(service.current()?.message).toBe("modal");
    });

    it("модальное без кнопок — всё равно вопрос: закрыть его человек обязан сам", async () => {
        const service = new NotificationService();
        const handle = service.show(message({ modal: true }));

        expect(service.current()?.message).toBe("hello");
        expect(service.passive()).toEqual([]);

        let settled = false;
        void handle.answered.then(() => {
            settled = true;
        });
        await Promise.resolve();
        expect(settled).toBe(false);

        service.dismiss(handle.id);
        await expect(handle.answered).resolves.toBeUndefined();
    });

    it("между модальными порядок обычный, FIFO", () => {
        const service = new NotificationService();
        service.show(message({ message: "modal one", modal: true }));
        service.show(message({ message: "modal two", modal: true }));

        expect(service.current()?.message).toBe("modal one");
        expect(service.queuedCount()).toBe(1);
    });
});

describe("NotificationService — clearAll", () => {
    it("убирает всё и доводит живые вопросы до «закрыто без выбора»", async () => {
        const service = new NotificationService();
        const passive = service.show(message({ severity: "error", message: "boom" }));
        const ask = service.show(message({ items: ["One"] }));
        const queued = service.show(message({ items: ["Two"] }));

        service.clearAll();

        expect(service.isEmpty()).toBe(true);
        await expect(passive.answered).resolves.toBeUndefined();
        await expect(ask.answered).resolves.toBeUndefined();
        await expect(queued.answered).resolves.toBeUndefined();
    });

    it("на пустом сервисе событие не файрит (нечего перерисовывать)", () => {
        const service = new NotificationService();
        const seen = vi.fn();
        service.onDidChange(seen);

        service.clearAll();
        expect(seen).not.toHaveBeenCalled();
    });

    it("файрит событие, когда что-то действительно сняли", () => {
        const service = new NotificationService();
        service.show(message());
        const seen = vi.fn();
        service.onDidChange(seen);

        service.clearAll();
        expect(seen).toHaveBeenCalledTimes(1);
    });
});
