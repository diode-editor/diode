import { EventEmitter } from "node:events";
import { deserialize, serialize } from "node:v8";

import { describe, expect, it, vi } from "vitest";

import type { ILogger } from "../../../platform/log/common/iLogger.ts";

import type { IIpcEndpoint } from "./ipcMessageChannel.ts";
import { IpcMessageChannel } from "./ipcMessageChannel.ts";

/** Delivery is asynchronous, like real Node IPC. */
class FakeIpcEndpoint extends EventEmitter implements IIpcEndpoint {
    public peer: FakeIpcEndpoint | null = null;
    public sent: unknown[] = [];
    public dead = false;

    public get connected(): boolean {
        return !this.dead;
    }

    public send(message: unknown): boolean {
        if (this.dead) return false;
        // Node's `serialization: "advanced"`: a structured clone, which throws on a function or a symbol.
        const serialized = serialize(message);
        this.sent.push(message);
        const peer = this.peer;
        if (peer === null) return false;
        queueMicrotask(() => {
            if (peer.dead) return;
            peer.emit("message", deserialize(serialized));
        });
        return true;
    }

    public kill(): void {
        this.dead = true;
        this.emit("disconnect");
    }
}

type RecordingLogger = ILogger & { warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

function fakeLogger(): RecordingLogger {
    return {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    } as unknown as RecordingLogger;
}

function pair(): [FakeIpcEndpoint, FakeIpcEndpoint] {
    const a = new FakeIpcEndpoint();
    const b = new FakeIpcEndpoint();
    a.peer = b;
    b.peer = a;
    return [a, b];
}

describe("IpcMessageChannel", () => {
    it("delivers messages a -> b asynchronously", async () => {
        const [a, b] = pair();
        const chA = new IpcMessageChannel(a);
        const chB = new IpcMessageChannel(b);
        const received: unknown[] = [];
        chB.onMessage((m) => received.push(m));
        chA.postMessage({ hello: "world" });
        expect(received).toHaveLength(0);
        await Promise.resolve();
        expect(received).toEqual([{ hello: "world" }]);
        chA.dispose();
        chB.dispose();
    });

    it("works both ways and preserves order", async () => {
        const [a, b] = pair();
        const chA = new IpcMessageChannel(a);
        const chB = new IpcMessageChannel(b);
        const fromA: unknown[] = [];
        const fromB: unknown[] = [];
        chA.onMessage((m) => fromB.push(m));
        chB.onMessage((m) => fromA.push(m));
        chA.postMessage("a1");
        chA.postMessage("a2");
        chB.postMessage("b1");
        await new Promise((r) => {
            queueMicrotask(() => {
                r(undefined);
            });
        });
        expect(fromA).toEqual(["a1", "a2"]);
        expect(fromB).toEqual(["b1"]);
        chA.dispose();
        chB.dispose();
    });

    it("after dispose postMessage is not delivered and listeners are not called", async () => {
        const [a, b] = pair();
        const chA = new IpcMessageChannel(a);
        const chB = new IpcMessageChannel(b);
        const received: unknown[] = [];
        chB.onMessage((m) => received.push(m));
        chB.dispose();
        chA.postMessage("hi");
        await Promise.resolve();
        expect(received).toEqual([]);
        chA.dispose();
    });

    it("an unsubscribed listener no longer receives", async () => {
        const [a, b] = pair();
        const chA = new IpcMessageChannel(a);
        const chB = new IpcMessageChannel(b);
        const received: unknown[] = [];
        const sub = chB.onMessage((m) => received.push(m));
        chA.postMessage(1);
        await Promise.resolve();
        sub.dispose();
        chA.postMessage(2);
        await Promise.resolve();
        expect(received).toEqual([1]);
        chA.dispose();
        chB.dispose();
    });

    it("after a disconnect event postMessage is a no-op", () => {
        const [a, b] = pair();
        const chA = new IpcMessageChannel(a);
        const chB = new IpcMessageChannel(b);
        const sendSpy = vi.spyOn(a, "send");
        b.kill();
        a.emit("disconnect");
        chA.postMessage("dropped");
        expect(sendSpy).not.toHaveBeenCalled();
        chA.dispose();
        chB.dispose();
    });

    it("dispose removes the endpoint subscriptions", () => {
        const [a] = pair();
        const ch = new IpcMessageChannel(a);
        expect(a.listenerCount("message")).toBe(1);
        expect(a.listenerCount("disconnect")).toBe(1);
        ch.dispose();
        expect(a.listenerCount("message")).toBe(0);
        expect(a.listenerCount("disconnect")).toBe(0);
    });

    it("an exception in endpoint.send does not escape", () => {
        const [a, b] = pair();
        const chA = new IpcMessageChannel(a);
        const chB = new IpcMessageChannel(b);
        a.send = (): boolean => {
            throw new Error("EPIPE");
        };
        expect(() => {
            chA.postMessage("x");
        }).not.toThrow();
        chA.dispose();
        chB.dispose();
    });

    it("send throws on a closed channel: the channel is marked dead silently, the next postMessage does not call send", () => {
        const [a] = pair();
        const logger = fakeLogger();
        const ch = new IpcMessageChannel(a, logger);
        a.dead = true; // `connected` is false, as on a child that exited before `disconnect` was observed
        a.send = (): boolean => {
            throw new Error("ERR_IPC_CHANNEL_CLOSED");
        };
        ch.postMessage("first");

        const sendSpy = vi.fn((): boolean => true);
        a.send = sendSpy;
        ch.postMessage("second");
        expect(sendSpy).not.toHaveBeenCalled();
        expect(logger.warn).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
        ch.dispose();
    });

    describe("a payload the structured clone rejects (what JSON used to drop silently)", () => {
        it("arrives as its JSON image — the function dropped, the rest intact — and the channel stays alive", async () => {
            const [a, b] = pair();
            const logger = fakeLogger();
            const chA = new IpcMessageChannel(a, logger);
            const chB = new IpcMessageChannel(b);
            const received: unknown[] = [];
            chB.onMessage((m) => received.push(m));

            chA.postMessage({
                kind: "notif",
                method: "statusBar.update",
                params: { arguments: [1, () => "clicked", { keep: true, drop: Symbol("s") }] },
            });
            chA.postMessage({ kind: "notif", method: "next", params: null });
            await Promise.resolve();

            expect(received).toEqual([
                { kind: "notif", method: "statusBar.update", params: { arguments: [1, null, { keep: true }] } },
                { kind: "notif", method: "next", params: null },
            ]);
            chA.dispose();
            chB.dispose();
        });

        it("is logged loudly with the envelope of the message, not the payload", () => {
            const [a] = pair();
            const logger = fakeLogger();
            const ch = new IpcMessageChannel(a, logger);

            ch.postMessage({ kind: "req", id: 7, method: "commands.executeCommand", params: { fn: () => 1 } });

            expect(logger.warn).toHaveBeenCalledTimes(1);
            const [text, summary, cause] = logger.warn.mock.calls[0] as [string, unknown, unknown];
            expect(text).toContain("JSON image");
            expect(summary).toBe("req#7 commands.executeCommand");
            expect(cause).toBeInstanceOf(Error);
            expect(logger.error).not.toHaveBeenCalled();
            ch.dispose();
        });

        it("a message JSON rejects too (a cycle next to a function) is dropped with an error, the channel stays alive", async () => {
            const [a, b] = pair();
            const logger = fakeLogger();
            const chA = new IpcMessageChannel(a, logger);
            const chB = new IpcMessageChannel(b);
            const received: unknown[] = [];
            chB.onMessage((m) => received.push(m));

            const cyclic: Record<string, unknown> = { fn: () => 1 };
            cyclic.self = cyclic;
            chA.postMessage({ kind: "notif", method: "bad", params: cyclic });
            chA.postMessage({ kind: "notif", method: "good", params: 1 });
            await Promise.resolve();

            expect(received).toEqual([{ kind: "notif", method: "good", params: 1 }]);
            expect(logger.error).toHaveBeenCalledTimes(1);
            const [text, summary] = logger.error.mock.calls[0] as [string, unknown];
            expect(text).toContain("dropped");
            expect(summary).toBe("notif bad");
            expect(logger.warn).not.toHaveBeenCalled();
            chA.dispose();
            chB.dispose();
        });

        it("the channel closing under the fallback send is still a closed channel, not an error", () => {
            const [a] = pair();
            const logger = fakeLogger();
            const ch = new IpcMessageChannel(a, logger);
            a.send = (): boolean => {
                a.dead = true;
                throw new Error("ERR_IPC_CHANNEL_CLOSED");
            };

            ch.postMessage({ fn: () => 1 });
            const sendSpy = vi.fn((): boolean => true);
            a.send = sendSpy;
            ch.postMessage("after");

            expect(sendSpy).not.toHaveBeenCalled();
            expect(logger.error).not.toHaveBeenCalled();
            ch.dispose();
        });

        it("a send that fails after the fallback while the channel is open is an error, not a dead channel", () => {
            const [a] = pair();
            const logger = fakeLogger();
            const ch = new IpcMessageChannel(a, logger);
            a.send = (): boolean => {
                throw new Error("could not be cloned");
            };

            ch.postMessage({ fn: () => 1 });
            const sendSpy = vi.fn((): boolean => true);
            a.send = sendSpy;
            ch.postMessage("after");

            expect(logger.error).toHaveBeenCalledTimes(1);
            expect(sendSpy).toHaveBeenCalledWith("after");
            ch.dispose();
        });

        it("without a logger the fallback still delivers", async () => {
            const [a, b] = pair();
            const chA = new IpcMessageChannel(a);
            const chB = new IpcMessageChannel(b);
            const received: unknown[] = [];
            chB.onMessage((m) => received.push(m));
            chA.postMessage({ fn: () => 1, n: 1 });
            await Promise.resolve();
            expect(received).toEqual([{ n: 1 }]);
            chA.dispose();
            chB.dispose();
        });
    });

    it("what JSON lost survives the structured clone: undefined fields, Map, Date", async () => {
        const [a, b] = pair();
        const chA = new IpcMessageChannel(a);
        const chB = new IpcMessageChannel(b);
        const received: unknown[] = [];
        chB.onMessage((m) => received.push(m));
        const when = new Date(0);
        chA.postMessage({ value: undefined, map: new Map([["k", 1]]), when });
        await Promise.resolve();
        expect(received).toEqual([{ value: undefined, map: new Map([["k", 1]]), when }]);
        expect(Object.keys(received[0] as object)).toEqual(["value", "map", "when"]);
        chA.dispose();
        chB.dispose();
    });

    it("onMessage after dispose returns a no-op disposable and does not subscribe (line 65)", async () => {
        const [a, b] = pair();
        const chA = new IpcMessageChannel(a);
        const chB = new IpcMessageChannel(b);
        chB.dispose();

        const received: unknown[] = [];
        const sub = chB.onMessage((m) => received.push(m));
        expect(() => {
            sub.dispose();
        }).not.toThrow();

        chA.postMessage("hi");
        await Promise.resolve();
        expect(received).toEqual([]);
        chA.dispose();
    });

    it("an incoming message after dispose is ignored (line 41)", () => {
        // An endpoint that does NOT remove the listener on off(), to simulate
        // a message arriving after the channel's dispose().
        const messageListeners: ((msg: unknown) => void)[] = [];
        const endpoint: IIpcEndpoint = {
            connected: true,
            send: () => true,
            on: (event: string, listener: (...args: never[]) => void): unknown => {
                if (event === "message") messageListeners.push(listener as (msg: unknown) => void);
                return undefined;
            },
            off: () => undefined, // no-op: the listener "survives" dispose
        };
        const ch = new IpcMessageChannel(endpoint);
        const received: unknown[] = [];
        ch.onMessage((m) => received.push(m));
        ch.dispose();
        messageListeners[0]({ late: true });
        expect(received).toEqual([]);
    });

    it("dispose is idempotent (line 77)", () => {
        const [a] = pair();
        const ch = new IpcMessageChannel(a);
        ch.dispose();
        expect(() => {
            ch.dispose();
        }).not.toThrow();
    });

    it("disposing a subscription twice is safe (line 71, index < 0 branch)", () => {
        const [a] = pair();
        const ch = new IpcMessageChannel(a);
        const sub = ch.onMessage(() => undefined);
        sub.dispose();
        expect(() => {
            sub.dispose();
        }).not.toThrow();
        ch.dispose();
    });
});
