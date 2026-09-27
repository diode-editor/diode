import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    type INotificationMessage,
    MAX_VISIBLE_NOTIFICATIONS,
    NOTIFICATION_AUTO_HIDE_MS,
    NotificationService,
} from "./notificationService.ts";

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

    it("время жизни зависит от строгости — значения эталона", () => {
        const service = new NotificationService();
        service.show(message({ severity: "info", message: "i" }));
        service.show(message({ severity: "warn", message: "w" }));
        service.show(message({ severity: "error", message: "e" }));

        vi.advanceTimersByTime(NOTIFICATION_AUTO_HIDE_MS.info);
        expect(service.passive().map((n) => n.message)).toEqual(["w", "e"]);

        vi.advanceTimersByTime(NOTIFICATION_AUTO_HIDE_MS.warn - NOTIFICATION_AUTO_HIDE_MS.info);
        expect(service.passive().map((n) => n.message)).toEqual(["e"]);

        vi.advanceTimersByTime(NOTIFICATION_AUTO_HIDE_MS.error - NOTIFICATION_AUTO_HIDE_MS.warn);
        expect(service.passive()).toEqual([]);
    });

    it("тост не уезжает раньше своего срока", () => {
        const service = new NotificationService();
        service.show(message({ severity: "info" }));

        vi.advanceTimersByTime(NOTIFICATION_AUTO_HIDE_MS.info - 1);
        expect(service.passive()).toHaveLength(1);

        vi.advanceTimersByTime(1);
        expect(service.passive()).toEqual([]);
    });

    it("порядок — от старого к новому (стек рисуется сверху вниз)", () => {
        const service = new NotificationService();
        service.show(message({ message: "one" }));
        service.show(message({ message: "two" }));

        expect(service.passive().map((n) => n.message)).toEqual(["one", "two"]);
    });

    it("сверх лимита тосты ЖДУТ МЕСТА, а не теряются", () => {
        const service = new NotificationService();
        const many = ["one", "two", "three", "four", "five"];
        for (const text of many) service.show(message({ severity: "error", message: text }));

        expect(service.passive()).toHaveLength(MAX_VISIBLE_NOTIFICATIONS);
        expect(service.passive().map((n) => n.message)).toEqual(many.slice(0, MAX_VISIBLE_NOTIFICATIONS));
        expect(service.queuedPassiveCount()).toBe(many.length - MAX_VISIBLE_NOTIFICATIONS);
    });

    it("время жизни ждущего тоста начинается с ПОКАЗА, а не с постановки в очередь", () => {
        const service = new NotificationService();
        for (const text of ["one", "two", "three", "four"]) {
            service.show(message({ severity: "info", message: text }));
        }
        // Ждущий («four») не должен истечь, пока стоит в очереди: ровно один
        // таймер на каждый ВИДИМЫЙ тост.
        expect(vi.getTimerCount()).toBe(MAX_VISIBLE_NOTIFICATIONS);

        // Первые трое уезжают по своему сроку — и «four» наконец показывается.
        vi.advanceTimersByTime(NOTIFICATION_AUTO_HIDE_MS.info);
        expect(service.passive().map((n) => n.message)).toEqual(["four"]);
        expect(service.queuedPassiveCount()).toBe(0);

        // И только теперь пошло его собственное время.
        vi.advanceTimersByTime(NOTIFICATION_AUTO_HIDE_MS.info - 1);
        expect(service.passive()).toHaveLength(1);
        vi.advanceTimersByTime(1);
        expect(service.passive()).toEqual([]);
    });

    it("закрытие видимого тоста пускает на его место ждущего", () => {
        const service = new NotificationService();
        const first = service.show(message({ severity: "error", message: "one" }));
        for (const text of ["two", "three", "four"]) {
            service.show(message({ severity: "error", message: text }));
        }
        expect(service.passive().map((n) => n.message)).toEqual(["one", "two", "three"]);

        service.dismiss(first.id);

        expect(service.passive().map((n) => n.message)).toEqual(["two", "three", "four"]);
        expect(service.queuedPassiveCount()).toBe(0);
    });

    it("dismiss снимает тост и ГАСИТ его таймер", () => {
        const service = new NotificationService();
        const handle = service.show(message());
        expect(vi.getTimerCount()).toBe(1);

        service.dismiss(handle.id);
        expect(service.passive()).toEqual([]);
        // Оставленный таймер выстрелил бы в снятый показ — его быть не должно.
        expect(vi.getTimerCount()).toBe(0);

        service.dismiss(handle.id); // повторный — no-op
        expect(service.passive()).toEqual([]);
    });

    it("dismiss снимает ИМЕННО адресованный тост, а не первый в стеке", () => {
        const service = new NotificationService();
        service.show(message({ severity: "error", message: "one" }));
        const second = service.show(message({ severity: "error", message: "two" }));

        service.dismiss(second.id);

        expect(service.passive().map((n) => n.message)).toEqual(["one"]);
    });

    it("dismiss по незнакомому id ничего не снимает", () => {
        const service = new NotificationService();
        const handle = service.show(message({ severity: "error" }));

        service.dismiss(handle.id + 100);

        expect(service.passive()).toHaveLength(1);
    });

    it("clearAll гасит таймеры всех тостов", () => {
        const service = new NotificationService();
        service.show(message({ message: "one" }));
        service.show(message({ message: "two" }));
        expect(vi.getTimerCount()).toBe(2);

        service.clearAll();

        expect(vi.getTimerCount()).toBe(0);
    });

    it("dispose убирает всё и не оставляет таймеров", () => {
        const service = new NotificationService();
        service.show(message());
        expect(vi.getTimerCount()).toBe(1);

        service.dispose();

        expect(service.isEmpty()).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("dispose доводит живой вопрос до «закрыто без выбора» — иначе спросивший ждал бы вечно", async () => {
        const service = new NotificationService();
        const handle = service.show(message({ items: ["One"] }));

        service.dispose();

        await expect(handle.answered).resolves.toBeUndefined();
    });

    it("isEmpty различает пустоту, живой тост и живой вопрос", () => {
        const passiveOnly = new NotificationService();
        expect(passiveOnly.isEmpty()).toBe(true);
        passiveOnly.show(message({ severity: "error" }));
        expect(passiveOnly.isEmpty()).toBe(false);

        const askOnly = new NotificationService();
        askOnly.show(message({ items: ["One"] }));
        expect(askOnly.isEmpty()).toBe(false);
        expect(askOnly.passive()).toEqual([]);
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

    it("индекс РОВНО по размеру набора — уже за его пределами", async () => {
        const service = new NotificationService();
        const handle = service.show(message({ items: ["One", "Two"] }));

        // У двух кнопок последний валидный индекс — 1; 2 это уже мимо.
        service.answer(handle.id, 2);
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

    it("закрытие адресуется ИМЕННО своему вопросу, а не показанному", async () => {
        const service = new NotificationService();
        const showing = service.show(message({ message: "first", items: ["One"] }));
        const queued = service.show(message({ message: "second", items: ["Two"] }));

        service.dismiss(queued.id);

        await expect(queued.answered).resolves.toBeUndefined();
        expect(service.current()?.message).toBe("first");
        expect(service.queuedCount()).toBe(0);
        service.answer(showing.id, 0);
        await expect(showing.answered).resolves.toBe(0);
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

    it("работает и когда живых тостов нет, а вопрос есть", async () => {
        const service = new NotificationService();
        const ask = service.show(message({ items: ["One"] }));

        service.clearAll();

        await expect(ask.answered).resolves.toBeUndefined();
        expect(service.current()).toBeNull();
    });

    it("работает и когда есть тост, а вопросов нет", () => {
        const service = new NotificationService();
        service.show(message({ severity: "error" }));

        service.clearAll();

        expect(service.passive()).toEqual([]);
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
