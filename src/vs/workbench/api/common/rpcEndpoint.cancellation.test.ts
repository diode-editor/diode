import { describe, expect, it, vi } from "vitest";

import { CancellationTokenSource, type ICancellationToken } from "../../../base/common/cancellation.ts";

import type { IMessageChannel } from "./iMessageChannel.ts";
import { createInProcessChannelPair } from "./inProcessChannelPair.ts";
import { CANCEL_REQUEST_METHOD, RpcEndpoint } from "./rpcEndpoint.ts";

/**
 * Транспорт отмены поверх RpcEndpoint: токен вызывающего → нотификация
 * `$/cancelRequest` → токен обработчика на той стороне. Транспорт общий для
 * всех методов — подключение нового провайдера к отмене сводится к проводке
 * токена (сегодня им пользуются только призрачные подсказки).
 */

const microtasks = async (turns = 4): Promise<void> => {
    for (let i = 0; i < turns; i++) await Promise.resolve();
};

function createEndpointPair(): {
    a: RpcEndpoint;
    b: RpcEndpoint;
    /** Канал принимающей стороны — на нём видно сами сообщения отмены. */
    chB: IMessageChannel;
    dispose: () => void;
} {
    const [chA, chB] = createInProcessChannelPair();
    const a = new RpcEndpoint(chA);
    const b = new RpcEndpoint(chB);
    return {
        a,
        b,
        chB,
        dispose: (): void => {
            a.dispose();
            b.dispose();
            chA.dispose();
            chB.dispose();
        },
    };
}

/** Нотификации отмены, пришедшие в канал (endpoint разбирает их сам, минуя хендлеры). */
function cancelsOn(channel: IMessageChannel): unknown[] {
    const seen: unknown[] = [];
    channel.onMessage((message) => {
        if ((message as { method?: unknown }).method === CANCEL_REQUEST_METHOD) seen.push(message);
    });
    return seen;
}

/** Обработчик, который держит ответ, пока тест не разрешит его отдать. */
function deferredHandler(): {
    handler: (params: unknown, token: ICancellationToken) => Promise<string>;
    tokenOf: () => ICancellationToken;
    finish: (value: string) => void;
    called: () => number;
} {
    let seen: ICancellationToken | null = null;
    let release: (value: string) => void = () => undefined;
    let calls = 0;
    return {
        handler: (_params, token) => {
            calls++;
            seen = token;
            return new Promise<string>((resolve) => {
                release = resolve;
            });
        },
        tokenOf: () => seen!,
        finish: (value) => {
            release(value);
        },
        called: () => calls,
    };
}

describe("RpcEndpoint — отмена запроса", () => {
    it("отменённый токен вызывающего гасит токен обработчика на той стороне", async () => {
        const { a, b, chB, dispose } = createEndpointPair();
        const cancels = cancelsOn(chB);
        const deferred = deferredHandler();
        b.handleRequest("slow", deferred.handler);

        const source = new CancellationTokenSource();
        const pending = a.request("slow", { x: 1 }, source.token);
        await microtasks();

        const observed = vi.fn();
        deferred.tokenOf().onCancellationRequested(observed);
        expect(deferred.tokenOf().isCancellationRequested).toBe(false);

        source.cancel();
        await microtasks();

        expect(deferred.tokenOf().isCancellationRequested).toBe(true);
        expect(observed).toHaveBeenCalledOnce();
        // На проводе — ровно одна нотификация отмены с номером этого запроса.
        expect(cancels).toEqual([{ kind: "notif", method: CANCEL_REQUEST_METHOD, params: { id: 1 } }]);

        // Отмена — просьба, а не разрыв: ответ всё равно доезжает.
        deferred.finish("late");
        expect(await pending).toBe("late");
        dispose();
    });

    it("без токена вызывающего обработчик получает неотменяемый токен", async () => {
        const { a, b, dispose } = createEndpointPair();
        let seen: ICancellationToken | null = null;
        b.handleRequest("plain", (_params, token) => {
            seen = token;
            return "ok";
        });

        expect(await a.request("plain")).toBe("ok");
        expect(seen!.isCancellationRequested).toBe(false);
        dispose();
    });

    it("отмена ПОСЛЕ ответа не шлёт нотификацию — отменять уже нечего", async () => {
        const [chA, chB] = createInProcessChannelPair();
        const a = new RpcEndpoint(chA);
        const b = new RpcEndpoint(chB);
        // Слушаем сам канал: `$/cancelRequest` разбирает принимающий endpoint,
        // до notification-хендлеров он не доходит — наблюдать нотификацию можно
        // только на проводе.
        const cancels = cancelsOn(chB);
        b.handleRequest("fast", () => "done");

        const source = new CancellationTokenSource();
        expect(await a.request("fast", {}, source.token)).toBe("done");
        source.cancel();
        await microtasks();

        expect(cancels).toEqual([]);
        a.dispose();
        b.dispose();
        chA.dispose();
        chB.dispose();
    });

    it("отмена, обогнавшая свой запрос, доезжает до обработчика отменённым токеном", async () => {
        const { a, b, dispose } = createEndpointPair();
        const deferred = deferredHandler();
        b.handleRequest("slow", deferred.handler);

        // Переупорядоченный транспорт: отмена запроса #1 приходит раньше, чем
        // сам запрос #1 (на упорядоченном канале это недостижимо, поэтому
        // нотификацию шлём руками).
        b.handleNotification("noop", () => undefined);
        a.notify(CANCEL_REQUEST_METHOD, { id: 1 });
        await microtasks();

        const pending = a.request("slow", { x: 1 });
        await microtasks();

        expect(deferred.tokenOf().isCancellationRequested).toBe(true);
        deferred.finish("late");
        expect(await pending).toBe("late");
        dispose();
    });

    it("отмена с чужой формой параметров и отмена без пары — тихие", async () => {
        const { a, b, dispose } = createEndpointPair();
        b.handleRequest("echo", (params) => params);

        a.notify(CANCEL_REQUEST_METHOD, { id: "не число" });
        a.notify(CANCEL_REQUEST_METHOD, undefined);
        a.notify(CANCEL_REQUEST_METHOD, { id: 999 });
        await microtasks();

        // Канал жив, запросы ходят как раньше.
        expect(await a.request("echo", { ok: true })).toEqual({ ok: true });
        dispose();
    });

    it("память об отменах-сиротах ограничена — вытесняется ровно самая старая", async () => {
        const { a, b, dispose } = createEndpointPair();
        const seen: ICancellationToken[] = [];
        const release: ((value: string) => void)[] = [];
        b.handleRequest("slow", (_params, token) => {
            seen.push(token);
            return new Promise<string>((resolve) => release.push(resolve));
        });

        // 65 отмен-сирот подряд при памяти на 64: вытесняется одна — первая.
        for (let id = 1; id <= 65; id++) a.notify(CANCEL_REQUEST_METHOD, { id });
        await microtasks();

        const first = a.request("slow", {}); // id 1 — его отмену уже забыли
        const second = a.request("slow", {}); // id 2 — отмена ещё помнится
        await microtasks();

        expect(seen[0].isCancellationRequested).toBe(false);
        expect(seen[1].isCancellationRequested).toBe(true);

        release[0]("one");
        release[1]("two");
        await Promise.all([first, second]);
        dispose();
    });

    it("dispose отменяет входящие запросы, которые ещё считаются", async () => {
        const [chA, chB] = createInProcessChannelPair();
        const a = new RpcEndpoint(chA);
        const b = new RpcEndpoint(chB);
        const deferred = deferredHandler();
        b.handleRequest("slow", deferred.handler);

        void a.request("slow", {}).catch(() => undefined);
        await microtasks();
        expect(deferred.tokenOf().isCancellationRequested).toBe(false);

        b.dispose();
        expect(deferred.tokenOf().isCancellationRequested).toBe(true);

        a.dispose();
        chA.dispose();
        chB.dispose();
    });

    it("dispose вызывающего снимает подписку на его токен — отмена никуда не уходит", async () => {
        const [chA, chB] = createInProcessChannelPair();
        const a = new RpcEndpoint(chA);
        const b = new RpcEndpoint(chB);
        const cancels: unknown[] = [];
        const deferred = deferredHandler();
        b.handleRequest("slow", deferred.handler);
        b.handleNotification(CANCEL_REQUEST_METHOD, (params) => cancels.push(params));

        const source = new CancellationTokenSource();
        void a.request("slow", {}, source.token).catch(() => undefined);
        await microtasks();

        a.dispose();
        source.cancel();
        await microtasks();

        expect(cancels).toEqual([]);
        b.dispose();
        chA.dispose();
        chB.dispose();
    });

    it("каждый запрос отменяется своим токеном — соседа не задевает", async () => {
        const { a, b, dispose } = createEndpointPair();
        const seen: ICancellationToken[] = [];
        const release: ((value: string) => void)[] = [];
        b.handleRequest("slow", (_params, token) => {
            seen.push(token);
            return new Promise<string>((resolve) => release.push(resolve));
        });

        const first = new CancellationTokenSource();
        const second = new CancellationTokenSource();
        const p1 = a.request("slow", { n: 1 }, first.token);
        const p2 = a.request("slow", { n: 2 }, second.token);
        await microtasks();

        first.cancel();
        await microtasks();

        expect(seen[0].isCancellationRequested).toBe(true);
        expect(seen[1].isCancellationRequested).toBe(false);

        release[0]("one");
        release[1]("two");
        expect(await p1).toBe("one");
        expect(await p2).toBe("two");
        dispose();
    });

    it("токен, отменённый ДО запроса, уезжает отменой сразу за самим запросом", async () => {
        const { a, b, dispose } = createEndpointPair();
        const deferred = deferredHandler();
        b.handleRequest("slow", deferred.handler);

        const source = new CancellationTokenSource();
        source.cancel();
        const pending = a.request("slow", {}, source.token);
        await microtasks();

        expect(deferred.called()).toBe(1);
        expect(deferred.tokenOf().isCancellationRequested).toBe(true);

        deferred.finish("late");
        await pending;
        dispose();
    });
});
