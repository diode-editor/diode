import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import type { IIpcEndpoint } from "./ipcMessageChannel.ts";
import { IpcMessageChannel } from "./ipcMessageChannel.ts";

/** Delivery is asynchronous, like real Node IPC. */
class FakeIpcEndpoint extends EventEmitter implements IIpcEndpoint {
    public peer: FakeIpcEndpoint | null = null;
    public sent: unknown[] = [];
    public dead = false;

    public send(message: unknown): boolean {
        if (this.dead) return false;
        this.sent.push(message);
        const peer = this.peer;
        if (peer === null) return false;
        // The JSON round-trip mimics Node IPC structured clone.
        const serialized = JSON.stringify(message);
        queueMicrotask(() => {
            if (peer.dead) return;
            peer.emit("message", JSON.parse(serialized));
        });
        return true;
    }

    public kill(): void {
        this.dead = true;
        this.emit("disconnect");
    }
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

    it("after an exception in send the channel is marked dead: the next postMessage does not call send", () => {
        const [a] = pair();
        const ch = new IpcMessageChannel(a);
        a.send = (): boolean => {
            throw new Error("EPIPE");
        };
        // The first postMessage catches the exception and sets alive=false.
        ch.postMessage("first");

        const sendSpy = vi.fn((): boolean => true);
        a.send = sendSpy;
        ch.postMessage("second");
        expect(sendSpy).not.toHaveBeenCalled();
        ch.dispose();
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
