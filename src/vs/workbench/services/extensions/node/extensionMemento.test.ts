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
