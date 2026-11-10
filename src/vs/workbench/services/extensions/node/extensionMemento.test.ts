import { describe, expect, it } from "vitest";

import { createExtensionMemento, type IExtensionMementoOptions } from "./extensionMemento.ts";

function memento(overrides: Partial<IExtensionMementoOptions> = {}) {
    const persisted: Record<string, unknown>[] = [];
    const m = createExtensionMemento({
        initial: {},
        withSync: false,
        persist: (value) => {
            persisted.push(value);
            return Promise.resolve();
        },
        ...overrides,
    });
    return { m, persisted };
}

describe("createExtensionMemento", () => {
    it("get returns the stored value, the default only for a missing key", async () => {
        const { m } = memento();
        expect(m.get("missing")).toBeUndefined();
        expect(m.get("missing", "fallback")).toBe("fallback");

        await m.update("shown", true);
        expect(m.get("shown")).toBe(true);
        expect(m.get("shown", "fallback")).toBe(true);
    });

    it("stores falsy values too: the default does not replace them", async () => {
        const { m } = memento();
        await m.update("count", 0);
        expect(m.get("count", 42)).toBe(0);
    });

    it("starts from the dictionary of previous runs", () => {
        const { m } = memento({ initial: { shown: true, count: 3 } });

        expect(m.get("shown")).toBe(true);
        expect(m.keys()).toEqual(["shown", "count"]);
    });

    it("each update sends the whole dictionary to the host; update(key, undefined) deletes the key", async () => {
        const { m, persisted } = memento({ initial: { a: 1 } });

        await m.update("b", 2);
        await m.update("a", undefined);

        expect(persisted).toEqual([{ a: 1, b: 2 }, { b: 2 }]);
        expect(m.get("a", "gone")).toBe("gone");
        expect(m.keys()).toEqual(["b"]);
    });

    it("the update promise is the host write promise", async () => {
        let resolveWrite!: () => void;
        const { m } = memento({
            persist: () =>
                new Promise<void>((resolve) => {
                    resolveWrite = resolve;
                }),
        });
        let done = false;

        const update = m.update("k", "v").then(() => {
            done = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(m.get("k")).toBe("v");
        expect(done).toBe(false);

        resolveWrite();
        await update;
        expect(done).toBe(true);
    });

    describe("[api:Memento.update] objects are stored as their JSON round trip, as upstream", () => {
        it("a later change to the passed object does not reach the stored value", async () => {
            const { m, persisted } = memento();
            const value = { list: [1, { deep: true }] };
            await m.update("k", value);
            value.list.push(2);

            expect(m.get("k")).toEqual({ list: [1, { deep: true }] });
            expect(m.get("k")).not.toBe(value);
            expect(persisted).toEqual([{ k: { list: [1, { deep: true }] } }]);
        });

        it("a toJSON result is what is kept: an array of dates becomes strings", async () => {
            const { m } = memento();
            await m.update("k", [new Date(0)]);

            expect(m.get("k")).toEqual(["1970-01-01T00:00:00.000Z"]);
        });

        it("a cycle throws synchronously and leaves the previous value", async () => {
            const { m, persisted } = memento();
            await m.update("k", "before");
            const cycle: { self?: unknown } = {};
            cycle.self = cycle;

            expect(() => void m.update("k", cycle)).toThrow(TypeError);
            expect(m.get("k")).toBe("before");
            expect(persisted).toHaveLength(1);
        });

        it("primitives and null are stored as they are: NaN stays NaN, though JSON would make it null", async () => {
            const { m } = memento();
            await m.update("null", null);
            await m.update("text", "x");
            await m.update("nan", Number.NaN);

            expect(m.get("null", "fallback")).toBeNull();
            expect(m.get("text")).toBe("x");
            expect(m.get("nan")).toBeNaN();
        });
    });

    it("setKeysForSync exists only on the globalState variant and does not throw", () => {
        const globalState = memento({ withSync: true }).m;
        const workspaceState = memento({ withSync: false }).m;
        expect(workspaceState.setKeysForSync).toBeUndefined();
        expect(typeof globalState.setKeysForSync).toBe("function");
        expect(() => {
            globalState.setKeysForSync?.(["a"]);
        }).not.toThrow();
    });
});
