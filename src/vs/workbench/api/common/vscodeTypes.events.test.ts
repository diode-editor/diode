import { describe, expect, it, vi } from "vitest";

import { DisposableImpl, EventEmitter } from "./vscodeTypes.ts";

describe("VscodeTypes — EventEmitter", () => {
    it("fire delivers data to all listeners", () => {
        const em = new EventEmitter<number>();
        const seen: number[] = [];
        em.event((n) => seen.push(n));
        em.event((n) => seen.push(n * 10));
        em.fire(3);
        expect(seen).toEqual([3, 30]);
    });

    it("disposing the subscription stops delivery", () => {
        const em = new EventEmitter<number>();
        const seen: number[] = [];
        const sub = em.event((n) => seen.push(n));
        em.fire(1);
        sub.dispose();
        em.fire(2);
        expect(seen).toEqual([1]);
    });

    it("thisArgs is bound", () => {
        const em = new EventEmitter<void>();
        const ctx = { hit: false };
        em.event(function (this: typeof ctx) {
            this.hit = true;
        }, ctx);
        em.fire();
        expect(ctx.hit).toBe(true);
    });

    it("disposables array receives the subscription", () => {
        const em = new EventEmitter<void>();
        const bag: DisposableImpl[] = [];
        em.event(() => undefined, undefined, bag);
        expect(bag).toHaveLength(1);
    });

    it("unsubscribing a listener during fire does not break the current pass", () => {
        const em = new EventEmitter<void>();
        const seen: string[] = [];
        const sub = em.event(() => {
            seen.push("a");
            sub.dispose();
        });
        em.event(() => seen.push("b"));
        em.fire();
        expect(seen).toEqual(["a", "b"]);
    });

    it("one listener throwing does not break fire", () => {
        const em = new EventEmitter<void>();
        const seen: string[] = [];
        em.event(() => {
            throw new Error("boom");
        });
        em.event(() => seen.push("ok"));
        expect(() => {
            em.fire();
        }).not.toThrow();
        expect(seen).toEqual(["ok"]);
    });

    it("repeated subscription dispose is safe (idx<0)", () => {
        const em = new EventEmitter<number>();
        const sub = em.event(() => undefined);
        sub.dispose();
        expect(() => {
            sub.dispose();
        }).not.toThrow();
    });

    it("emitter.dispose() clears all listeners", () => {
        const em = new EventEmitter<number>();
        const seen: number[] = [];
        em.event((n) => seen.push(n));
        em.dispose();
        em.fire(5);
        expect(seen).toEqual([]);
    });
});

describe("VscodeTypes — DisposableImpl", () => {
    it("dispose invokes the callback", () => {
        const cb = vi.fn();
        new DisposableImpl(cb).dispose();
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it("from aggregates and disposes all", () => {
        const a = vi.fn();
        const b = vi.fn();
        DisposableImpl.from({ dispose: a }, { dispose: b }).dispose();
        expect(a).toHaveBeenCalledTimes(1);
        expect(b).toHaveBeenCalledTimes(1);
    });
});
