import { describe, expect, it, vi } from "vitest";

import { BugIndicatingError } from "../../../base/common/errors.ts";
import type { ILogger } from "../../../platform/log/common/iLogger.ts";

import { createInProcessChannelPair } from "./inProcessChannelPair.ts";
import { RpcEndpoint } from "./rpcEndpoint.ts";

const microtasks = async (turns = 4): Promise<void> => {
    for (let i = 0; i < turns; i++) await Promise.resolve();
};

function makeSpyLogger(): ILogger {
    return {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        isEnabled: () => true,
    };
}

function createEndpointPair(): { a: RpcEndpoint; b: RpcEndpoint; dispose: () => void } {
    const [chA, chB] = createInProcessChannelPair();
    const a = new RpcEndpoint(chA);
    const b = new RpcEndpoint(chB);
    return {
        a,
        b,
        dispose: (): void => {
            a.dispose();
            b.dispose();
            chA.dispose();
            chB.dispose();
        },
    };
}

describe("RpcEndpoint", () => {
    it("request resolves with handler's result", async () => {
        const { a, b, dispose } = createEndpointPair();
        b.handleRequest("echo", (params) => params);
        const result = await a.request("echo", { hi: 1 });
        expect(result).toEqual({ hi: 1 });
        dispose();
    });

    it("request to unknown method rejects with no-handler error", async () => {
        const { a, dispose } = createEndpointPair();
        await expect(a.request("missing")).rejects.toThrow(/No handler/);
        dispose();
    });

    it("ошибка обработчика доезжает с именем, кодом, стеком и причиной", async () => {
        const { a, b, dispose } = createEndpointPair();
        const thrown = Object.assign(new TypeError("нет файла", { cause: new Error("ENOENT") }), {
            code: "FileNotFound",
        });
        b.handleRequest("fs", () => {
            throw thrown;
        });
        const error = await a.request("fs").catch((e: unknown) => e);
        expect(error).toBeInstanceOf(Error);
        expect(error).toMatchObject({
            name: "TypeError",
            message: "нет файла",
            code: "FileNotFound",
            stack: thrown.stack,
        });
        expect((error as Error).cause).toMatchObject({ name: "Error", message: "ENOENT" });
        dispose();
    });

    it("propagates handler errors via rejected promise", async () => {
        const { a, b, dispose } = createEndpointPair();
        b.handleRequest("boom", () => {
            throw new Error("nope");
        });
        await expect(a.request("boom")).rejects.toThrow("nope");
        dispose();
    });

    it("notify delivers without response", async () => {
        const { a, b, dispose } = createEndpointPair();
        const received: unknown[] = [];
        b.handleNotification("event", (params) => received.push(params));
        a.notify("event", { x: 1 });
        await Promise.resolve();
        await Promise.resolve();
        expect(received).toEqual([{ x: 1 }]);
        dispose();
    });

    it("swallows a throwing notification handler but logs a warning", async () => {
        const [chA, chB] = createInProcessChannelPair();
        const a = new RpcEndpoint(chA);
        const logger = makeSpyLogger();
        const b = new RpcEndpoint(chB, logger);
        b.handleNotification("event", () => {
            throw new Error("handler blew up");
        });
        // Must not reject or throw — notifications have no response channel.
        a.notify("event", { x: 1 });
        await Promise.resolve();
        await Promise.resolve();
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("notification handler"), expect.any(Error));
        a.dispose();
        b.dispose();
        chA.dispose();
        chB.dispose();
    });

    it("supports concurrent requests with distinct ids", async () => {
        const { a, b, dispose } = createEndpointPair();
        b.handleRequest("double", (params) => (params as number) * 2);
        const results = await Promise.all([a.request("double", 1), a.request("double", 2), a.request("double", 3)]);
        expect(results).toEqual([2, 4, 6]);
        dispose();
    });

    it("dispose rejects pending requests", async () => {
        const { a, b, dispose } = createEndpointPair();
        b.handleRequest("never", () => new Promise(() => undefined));
        const pending = a.request("never");
        a.dispose();
        await expect(pending).rejects.toThrow(/disposed/);
        b.dispose();
        dispose();
    });

    it("handler disposable removes the handler", async () => {
        const { a, b, dispose } = createEndpointPair();
        const sub = b.handleRequest("hello", () => "world");
        expect(await a.request("hello")).toBe("world");
        sub.dispose();
        await expect(a.request("hello")).rejects.toThrow(/No handler/);
        dispose();
    });

    it("rejects a request issued AFTER dispose without sending it (line 64)", async () => {
        const [chA] = createInProcessChannelPair();
        const a = new RpcEndpoint(chA);
        a.dispose();
        await expect(a.request("late")).rejects.toThrow(/disposed; cannot request "late"/);
        chA.dispose();
    });

    it("notify after dispose is a silent no-op and sends nothing (line 76)", () => {
        const [chA, chB] = createInProcessChannelPair();
        const a = new RpcEndpoint(chA);
        const spy = vi.spyOn(chA, "postMessage");
        a.dispose();
        expect(() => {
            a.notify("event", { x: 1 });
        }).not.toThrow();
        expect(spy).not.toHaveBeenCalled();
        chA.dispose();
        chB.dispose();
    });

    it("второй обработчик того же запроса — ошибка, первый остаётся", async () => {
        const { a, b, dispose } = createEndpointPair();
        b.handleRequest("m", () => "first");
        expect(() => b.handleRequest("m", () => "second")).toThrow(BugIndicatingError);
        expect(() => b.handleRequest("m", () => "second")).toThrow('request handler for "m" is already registered');
        expect(await a.request("m")).toBe("first");
        dispose();
    });

    it("повторный dispose снятой подписки не снимает нового обработчика", async () => {
        const { a, b, dispose } = createEndpointPair();
        const firstSub = b.handleRequest("m", () => "first");
        firstSub.dispose();
        b.handleRequest("m", () => "second");
        firstSub.dispose();
        expect(await a.request("m")).toBe("second");
        dispose();
    });

    it("нотификация без обработчика — warn один раз на метод", async () => {
        const warn = vi.fn();
        const [ca, cb] = createInProcessChannelPair();
        const a = new RpcEndpoint(ca);
        const b = new RpcEndpoint(cb, {
            trace: vi.fn(),
            debug: vi.fn(),
            info: vi.fn(),
            warn,
            error: vi.fn(),
            isEnabled: () => true,
        });
        a.notify("ghost", 1);
        a.notify("ghost", 2);
        a.notify("other", 3);
        await microtasks();
        expect(warn.mock.calls).toEqual([
            ['no handler for notification "ghost"'],
            ['no handler for notification "other"'],
        ]);
        a.dispose();
        b.dispose();
    });

    it("disposing a superseded notification subscription keeps the live handler (line 97 false branch)", async () => {
        const { a, b, dispose } = createEndpointPair();
        const received: unknown[] = [];
        const firstSub = b.handleNotification("evt", () => received.push("first"));
        b.handleNotification("evt", () => received.push("second")); // overwrites "first"
        // Disposing the superseded subscription must be a no-op (get(method) !== firstHandler).
        firstSub.dispose();
        a.notify("evt", null);
        await microtasks();
        expect(received).toEqual(["second"]);
        dispose();
    });

    it("ignores a non-object incoming message and does not trace it (lines 117, 194)", async () => {
        const [chA, chB] = createInProcessChannelPair();
        const logger = makeSpyLogger();
        const a = new RpcEndpoint(chA, logger);
        const b = new RpcEndpoint(chB);
        // A primitive on the wire must be ignored by both traceIncoming and handleIncoming.
        chB.postMessage(42);
        await microtasks();
        // traceIncoming returned early — nothing logged for the primitive.
        const traceCalls = (logger.trace as ReturnType<typeof vi.fn>).mock.calls;
        expect(traceCalls.every((c) => !String(c[0]).includes("42"))).toBe(true);
        a.dispose();
        b.dispose();
        chA.dispose();
        chB.dispose();
    });

    it("ignores a response for an unknown request id (line 171)", async () => {
        const [chA, chB] = createInProcessChannelPair();
        const a = new RpcEndpoint(chA);
        const b = new RpcEndpoint(chB);
        // No pending request with id 9999 — must be silently dropped.
        expect(() => {
            chB.postMessage({ kind: "res", id: 9999, result: 1 });
        }).not.toThrow();
        await microtasks();
        a.dispose();
        b.dispose();
        chA.dispose();
        chB.dispose();
    });

    it("ignores a notification with no registered handler (line 182)", async () => {
        const { a, b, dispose } = createEndpointPair();
        // No handler registered for "unhandled" — handleNotificationMessage returns early.
        expect(() => {
            a.notify("unhandled", { x: 1 });
        }).not.toThrow();
        await microtasks();
        dispose();
        void b;
    });

    it("stringifies a non-Error throw from a handler into the response (line 157 false branch)", async () => {
        const [chA, chB] = createInProcessChannelPair();
        const a = new RpcEndpoint(chA);
        const b = new RpcEndpoint(chB);
        // Сырой ответ на проводе — форма SerializedError и для не-Error отказа.
        const wire: unknown[] = [];
        chA.onMessage((message) => wire.push(message));
        b.handleRequest("strthrow", () => {
            throw "plain string failure"; // eslint-disable-line @typescript-eslint/only-throw-error
        });
        const error = await a.request("strthrow").catch((e: unknown) => e);
        expect(error).toMatchObject({ name: "Error", message: "plain string failure", stack: "" });
        expect(wire).toContainEqual(
            expect.objectContaining({
                kind: "res",
                error: { $isError: true, name: "Error", message: "plain string failure", stack: "" },
            }),
        );
        a.dispose();
        b.dispose();
    });

    it("отказ обработчика пишется в warn отвечающей стороны с методом и сообщением", async () => {
        const [chA, chB] = createInProcessChannelPair();
        const logger = makeSpyLogger();
        const a = new RpcEndpoint(chA);
        const b = new RpcEndpoint(chB, logger);
        b.handleRequest("boom", () => {
            throw new Error("kaboom");
        });
        await expect(a.request("boom")).rejects.toThrow("kaboom");
        expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/^-> res#\d+ boom ERROR: kaboom$/));
        a.dispose();
        b.dispose();
    });

    it("sends no response when a resolving request's endpoint was disposed mid-flight (line 150)", async () => {
        const [chA, chB] = createInProcessChannelPair();
        const a = new RpcEndpoint(chA);
        const b = new RpcEndpoint(chB);
        let release: (v: unknown) => void = () => undefined;
        b.handleRequest("slow", () => new Promise((resolve) => (release = resolve)));

        const pending = a.request("slow");
        void pending.catch(() => undefined); // never resolves once b is gone — swallow
        await microtasks(); // request reaches b, handler starts and parks

        const responseSpy = vi.spyOn(chB, "postMessage");
        b.dispose();
        release("done"); // success callback fires but sees disposed === true
        await microtasks();

        expect(responseSpy).not.toHaveBeenCalled();
        a.dispose();
        chA.dispose();
        chB.dispose();
    });

    it("sends no response when a rejecting request's endpoint was disposed mid-flight (line 156)", async () => {
        const [chA, chB] = createInProcessChannelPair();
        const a = new RpcEndpoint(chA);
        const b = new RpcEndpoint(chB);
        let fail: (reason: unknown) => void = () => undefined;
        b.handleRequest("slowfail", () => new Promise((_, reject) => (fail = reject)));

        const pending = a.request("slowfail");
        void pending.catch(() => undefined);
        await microtasks();

        const responseSpy = vi.spyOn(chB, "postMessage");
        b.dispose();
        fail(new Error("too late")); // error callback fires but sees disposed === true
        await microtasks();

        expect(responseSpy).not.toHaveBeenCalled();
        a.dispose();
        chA.dispose();
        chB.dispose();
    });

    describe("traceIncoming logging branches (lines 194-219)", () => {
        it("traces an incoming request and a successful response", async () => {
            const [chA, chB] = createInProcessChannelPair();
            const hostLogger = makeSpyLogger();
            const runtimeLogger = makeSpyLogger();
            const a = new RpcEndpoint(chA, hostLogger);
            const b = new RpcEndpoint(chB, runtimeLogger);

            b.handleRequest("echo", (p) => p);
            await a.request("echo", { v: 1 });

            // runtime saw an incoming request
            expect(runtimeLogger.trace).toHaveBeenCalledWith(expect.stringContaining("<- req#"), { v: 1 });
            // host saw an incoming successful response
            expect(hostLogger.trace).toHaveBeenCalledWith(expect.stringMatching(/<- res#\d+/), { v: 1 });

            a.dispose();
            b.dispose();
            chA.dispose();
            chB.dispose();
        });

        it("traces an incoming error-response", async () => {
            const [chA, chB] = createInProcessChannelPair();
            const hostLogger = makeSpyLogger();
            const a = new RpcEndpoint(chA, hostLogger);
            const b = new RpcEndpoint(chB);

            b.handleRequest("boom", () => {
                throw new Error("kaboom");
            });
            await expect(a.request("boom")).rejects.toThrow("kaboom");

            expect(hostLogger.trace).toHaveBeenCalledWith(expect.stringContaining("ERROR: kaboom"));

            a.dispose();
            b.dispose();
            chA.dispose();
            chB.dispose();
        });

        it("traces an incoming notification", async () => {
            const [chA, chB] = createInProcessChannelPair();
            const runtimeLogger = makeSpyLogger();
            const a = new RpcEndpoint(chA);
            const b = new RpcEndpoint(chB, runtimeLogger);

            b.handleNotification("hello", () => undefined);
            a.notify("hello", { x: 9 });
            await Promise.resolve();
            await Promise.resolve();

            expect(runtimeLogger.trace).toHaveBeenCalledWith(expect.stringContaining("<- notif hello"), { x: 9 });

            a.dispose();
            b.dispose();
            chA.dispose();
            chB.dispose();
        });

        it("ignores messages with an unknown kind (default branch)", async () => {
            const [chA, chB] = createInProcessChannelPair();
            const logger = makeSpyLogger();
            const a = new RpcEndpoint(chA, logger);
            const b = new RpcEndpoint(chB);

            chB.postMessage({ kind: "bogus", id: 1 });
            await Promise.resolve();
            await Promise.resolve();

            const calls = (logger.trace as ReturnType<typeof vi.fn>).mock.calls;
            expect(calls.every((c) => !String(c[0]).includes("bogus"))).toBe(true);

            a.dispose();
            b.dispose();
            chA.dispose();
            chB.dispose();
        });
    });
});
