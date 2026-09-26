import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";

import { MAX_VISIBLE_NOTIFICATIONS, NotificationService } from "./notificationService.ts";

/** Конфиг с единственным интересным ключом — таймаутом автоскрытия. */
function configWith(autoHideTimeout?: unknown): IConfigurationService {
    return {
        get: (key: string) => (key === "notifications.autoHideTimeout" ? autoHideTimeout : undefined),
        getValue: () => undefined,
        inspect: () => ({ key: "", value: undefined, default: undefined, user: undefined, profile: undefined }),
        onDidChangeConfiguration: () => ({ dispose: () => undefined }),
    } as unknown as IConfigurationService;
}

/**
 * Сервис с заданным `notifications.autoHideTimeout`. Параметр обязателен и без
 * дефолта: `undefined` — полноправный случай («настройки нет»), и дефолтное
 * значение параметра его бы подменило.
 */
function makeService(autoHideTimeout: unknown): NotificationService {
    return new NotificationService(configWith(autoHideTimeout));
}

describe("NotificationService", () => {
    it("показанное сообщение попадает в стек и файрит подписчиков", () => {
        const service = makeService(0);
        const listener = vi.fn();
        service.onDidChangeNotifications(listener);
        void service.notify({ severity: "warning", message: "careful", items: ["OK"] });
        expect(listener).toHaveBeenCalledTimes(1);
        expect(service.notifications()).toEqual([{ id: 1, severity: "warning", message: "careful", items: ["OK"] }]);
    });

    it("сообщение без items получает пустой список кнопок", () => {
        const service = makeService(0);
        void service.notify({ severity: "info", message: "fyi" });
        expect(service.notifications().at(0)?.items).toEqual([]);
    });

    it("accept резолвится индексом нажатой кнопки и снимает сообщение", async () => {
        const service = makeService(0);
        const answer = service.notify({ severity: "info", message: "fyi", items: ["Activate", "Free"] });
        service.accept(1, 1);
        await expect(answer).resolves.toBe(1);
        expect(service.notifications()).toEqual([]);
    });

    it("accept с индексом вне кнопок ничего не делает: соврать расширению нельзя", async () => {
        const service = makeService(0);
        const answer = service.notify({ severity: "info", message: "fyi", items: ["Activate"] });
        service.accept(1, 1);
        service.accept(1, -1);
        expect(service.notifications()).toHaveLength(1);
        // Сообщение всё ещё живо — закрываем его сами, чтобы обещание дорешалось.
        service.dismiss(1);
        await expect(answer).resolves.toBeUndefined();
    });

    // Все проверки ниже — на ДВУХ сообщениях: с одним «найти по id» неотличимо
    // от «взять первое», и подмена предиката в find/findIndex проходит незаметно.
    it("id монотонно растут — адресация показов не должна путать соседей", () => {
        const service = makeService(0);
        void service.notify({ severity: "info", message: "a" });
        void service.notify({ severity: "info", message: "b" });
        expect(service.notifications().map((n) => n.id)).toEqual([1, 2]);
    });

    it("accept адресуется id, а не позицией: отвечает ВТОРОЕ, первое остаётся", async () => {
        const service = makeService(0);
        const first = service.notify({ severity: "info", message: "a", items: ["x"] });
        const second = service.notify({ severity: "info", message: "b", items: ["y"] });
        service.accept(2, 0);
        await expect(second).resolves.toBe(0);
        expect(service.notifications().map((n) => n.message)).toEqual(["a"]);
        service.clearAll();
        await expect(first).resolves.toBeUndefined();
    });

    it("dismiss тоже адресуется id: закрытие второго не трогает первое", async () => {
        const service = makeService(0);
        const first = service.notify({ severity: "error", message: "a", items: ["x"] });
        const second = service.notify({ severity: "error", message: "b", items: ["y"] });
        service.dismiss(2);
        await expect(second).resolves.toBeUndefined();
        expect(service.notifications().map((n) => n.id)).toEqual([1]);
        service.clearAll();
        await expect(first).resolves.toBeUndefined();
    });

    it("accept с чужим индексом у ВТОРОГО сообщения не закрывает первое", () => {
        const service = makeService(0);
        void service.notify({ severity: "info", message: "a", items: ["x", "y"] });
        void service.notify({ severity: "info", message: "b", items: ["z"] });
        // У второго кнопка одна — индекс 1 за его пределами, хотя у первого он есть.
        service.accept(2, 1);
        expect(service.notifications().map((n) => n.id)).toEqual([1, 2]);
    });

    it("accept по неизвестному id — no-op", () => {
        const service = makeService(0);
        void service.notify({ severity: "info", message: "fyi", items: ["OK"] });
        service.accept(42, 0);
        expect(service.notifications()).toHaveLength(1);
    });

    it("dismiss резолвится undefined; повторный dismiss — no-op", async () => {
        const service = makeService(0);
        const answer = service.notify({ severity: "error", message: "boom", items: ["Retry"] });
        const listener = vi.fn();
        service.onDidChangeNotifications(listener);
        service.dismiss(1);
        service.dismiss(1);
        await expect(answer).resolves.toBeUndefined();
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("clearAll дорешивает обещания ВСЕХ живых сообщений", async () => {
        const service = makeService(0);
        const first = service.notify({ severity: "info", message: "a", items: ["x"] });
        const second = service.notify({ severity: "error", message: "b", items: ["y"] });
        service.clearAll();
        await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
        expect(service.notifications()).toEqual([]);
    });

    it("dispose — тоже путь закрытия: ждущие обещания не остаются висеть", async () => {
        const service = makeService(0);
        const answer = service.notify({ severity: "error", message: "boom", items: ["Retry"] });
        service.dispose();
        await expect(answer).resolves.toBeUndefined();
    });

    it(`больше ${String(MAX_VISIBLE_NOTIFICATIONS)} — вытесняется самое старое`, async () => {
        const service = makeService(0);
        const answers = ["a", "b", "c", "d"].map((message) =>
            service.notify({ severity: "error", message, items: ["x"] }),
        );
        expect(service.notifications().map((n) => n.message)).toEqual(["b", "c", "d"]);
        // Вытесненное — «человек закрыл»: обещание расширения дорешано, а не брошено.
        await expect(answers[0]).resolves.toBeUndefined();
        service.clearAll();
        await expect(Promise.all(answers)).resolves.toEqual([undefined, undefined, undefined, undefined]);
    });

    describe("автоскрытие", () => {
        beforeEach(() => {
            vi.useFakeTimers();
            return () => {
                vi.useRealTimers();
            };
        });

        it("info без кнопок гаснет сам по таймауту из настройки", async () => {
            const service = makeService(1000);
            const answer = service.notify({ severity: "info", message: "fyi" });
            expect(service.notifications()).toHaveLength(1);
            vi.advanceTimersByTime(1000);
            await expect(answer).resolves.toBeUndefined();
            expect(service.notifications()).toEqual([]);
        });

        // Дефолт — 15 секунд, как в VS Code: настройки нет либо она не число.
        it.each([
            ["нет настройки", undefined],
            ["строка", "soon"],
            ["NaN", Number.NaN],
        ])("дефолт применяется: %s", (_case, configured) => {
            const service = makeService(configured);
            void service.notify({ severity: "info", message: "fyi" });
            vi.advanceTimersByTime(14_999);
            expect(service.notifications()).toHaveLength(1);
            vi.advanceTimersByTime(1);
            expect(service.notifications()).toEqual([]);
        });

        it.each([0, -5])("%i в настройке выключает автоскрытие", (configured) => {
            const service = makeService(configured);
            void service.notify({ severity: "info", message: "fyi" });
            vi.advanceTimersByTime(60_000);
            expect(service.notifications()).toHaveLength(1);
        });

        it("кнопки и не-info уровни сами не гаснут: вопрос и ошибку надо прочитать", () => {
            const service = makeService(1000);
            void service.notify({ severity: "info", message: "вопрос", items: ["OK"] });
            void service.notify({ severity: "warning", message: "careful" });
            void service.notify({ severity: "error", message: "boom" });
            vi.advanceTimersByTime(60_000);
            expect(service.notifications()).toHaveLength(3);
        });

        it("ответ до таймаута снимает таймер: погасшее сообщение не закрывается второй раз", async () => {
            const service = makeService(1000);
            const answer = service.notify({ severity: "info", message: "fyi" });
            service.dismiss(1);
            await expect(answer).resolves.toBeUndefined();
            const listener = vi.fn();
            service.onDidChangeNotifications(listener);
            vi.advanceTimersByTime(60_000);
            expect(listener).not.toHaveBeenCalled();
        });
    });

    it("подписка снимается dispose'ом ручки", () => {
        const service = makeService(0);
        const listener = vi.fn();
        const subscription = service.onDidChangeNotifications(listener);
        subscription.dispose();
        void service.notify({ severity: "info", message: "fyi" });
        expect(listener).not.toHaveBeenCalled();
    });

    it("notifications() отдаёт копию: правка снаружи не трогает стек", () => {
        const service = makeService(0);
        void service.notify({ severity: "info", message: "fyi" });
        const snapshot = service.notifications() as unknown as { id: number }[];
        snapshot.length = 0;
        expect(service.notifications()).toHaveLength(1);
    });
});
