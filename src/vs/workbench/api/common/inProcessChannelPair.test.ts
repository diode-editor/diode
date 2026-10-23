import { describe, expect, it } from "vitest";

import { createInProcessChannelPair } from "./inProcessChannelPair.ts";

describe("InProcessChannelPair", () => {
    it("delivers messages asynchronously from a to b", async () => {
        const [a, b] = createInProcessChannelPair();
        const received: unknown[] = [];
        b.onMessage((m) => received.push(m));
        a.postMessage({ hello: "world" });
        expect(received).toHaveLength(0); // not synchronous
        await Promise.resolve();
        expect(received).toEqual([{ hello: "world" }]);
        a.dispose();
        b.dispose();
    });

    it("delivers messages in both directions", async () => {
        const [a, b] = createInProcessChannelPair();
        const fromA: unknown[] = [];
        const fromB: unknown[] = [];
        a.onMessage((m) => fromB.push(m));
        b.onMessage((m) => fromA.push(m));
        a.postMessage(1);
        b.postMessage(2);
        await new Promise((r) => {
            queueMicrotask(() => {
                r(undefined);
            });
        });
        expect(fromA).toEqual([1]);
        expect(fromB).toEqual([2]);
    });

    it("preserves order of multiple messages", async () => {
        const [a, b] = createInProcessChannelPair();
        const received: unknown[] = [];
        b.onMessage((m) => received.push(m));
        a.postMessage("a");
        a.postMessage("b");
        a.postMessage("c");
        await new Promise((r) => {
            queueMicrotask(() => {
                r(undefined);
            });
        });
        expect(received).toEqual(["a", "b", "c"]);
    });

    it("structurally clones (mutating sender's object does not affect receiver)", async () => {
        const [a, b] = createInProcessChannelPair();
        let received: { v: number } | null = null;
        b.onMessage((m) => {
            received = m as { v: number };
        });
        const payload = { v: 1 };
        a.postMessage(payload);
        payload.v = 999;
        await Promise.resolve();
        expect(received).toEqual({ v: 1 });
    });

    it("mirrors the IPC transport: a Map and an undefined field survive the structured clone", async () => {
        const [a, b] = createInProcessChannelPair();
        const received: unknown[] = [];
        b.onMessage((m) => received.push(m));
        a.postMessage({ gap: undefined, map: new Map([["k", 1]]) });
        await Promise.resolve();
        expect(received).toEqual([{ gap: undefined, map: new Map([["k", 1]]) }]);
        expect(Object.keys(received[0] as object)).toEqual(["gap", "map"]);
    });

    it("mirrors the IPC fallback: a function in the payload is dropped the way JSON dropped it, the message arrives", async () => {
        const [a, b] = createInProcessChannelPair();
        const received: unknown[] = [];
        b.onMessage((m) => received.push(m));
        a.postMessage({ arguments: [1, () => 2], fn: () => 3 });
        await Promise.resolve();
        expect(received).toEqual([{ arguments: [1, null] }]);
    });

    it("unsubscribed listener stops receiving", async () => {
        const [a, b] = createInProcessChannelPair();
        const received: unknown[] = [];
        const sub = b.onMessage((m) => received.push(m));
        a.postMessage(1);
        await Promise.resolve();
        sub.dispose();
        a.postMessage(2);
        await Promise.resolve();
        expect(received).toEqual([1]);
    });

    it("after dispose, postMessage is a no-op and listeners are not invoked", async () => {
        const [a, b] = createInProcessChannelPair();
        const received: unknown[] = [];
        b.onMessage((m) => received.push(m));
        b.dispose();
        a.postMessage("hello");
        await Promise.resolve();
        expect(received).toEqual([]);
    });

    it("onMessage on an already-disposed channel returns a no-op subscription", async () => {
        const [a, b] = createInProcessChannelPair();
        b.dispose();
        const received: unknown[] = [];
        const sub = b.onMessage((m) => received.push(m));
        a.postMessage("hello");
        await Promise.resolve();
        expect(received).toEqual([]);
        expect(() => {
            sub.dispose();
        }).not.toThrow();
    });

    it("postMessage on the disposed sending channel is a no-op (line 31)", async () => {
        const [a, b] = createInProcessChannelPair();
        const received: unknown[] = [];
        b.onMessage((m) => received.push(m));
        a.dispose(); // dispose the *sender*
        a.postMessage("hello");
        await Promise.resolve();
        expect(received).toEqual([]);
        b.dispose();
    });

    it("dispose is idempotent (line 60)", () => {
        const [a, b] = createInProcessChannelPair();
        a.dispose();
        expect(() => {
            a.dispose();
        }).not.toThrow();
        b.dispose();
    });

    it("disposing the same subscription twice is safe (line 54 index < 0 branch)", () => {
        const [a, b] = createInProcessChannelPair();
        const sub = b.onMessage(() => undefined);
        sub.dispose();
        // Second dispose: the listener is already gone (indexOf === -1).
        expect(() => {
            sub.dispose();
        }).not.toThrow();
        a.dispose();
        b.dispose();
    });
});
