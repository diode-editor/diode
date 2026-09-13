import { describe, expect, it } from "vitest";

import { createExtensionMemento } from "./extensionMemento.ts";

describe("createExtensionMemento", () => {
    it("get отдаёт сохранённое, дефолт — только для отсутствующего ключа", async () => {
        const memento = createExtensionMemento(false);
        expect(memento.get("missing")).toBeUndefined();
        expect(memento.get("missing", "fallback")).toBe("fallback");

        await memento.update("shown", true);
        expect(memento.get("shown")).toBe(true);
        expect(memento.get("shown", "fallback")).toBe(true);
    });

    it("хранит и falsy-значения — дефолт не подменяет их", async () => {
        const memento = createExtensionMemento(false);
        await memento.update("count", 0);
        expect(memento.get("count", 42)).toBe(0);
    });

    it("update(key, undefined) удаляет ключ (семантика vscode)", async () => {
        const memento = createExtensionMemento(false);
        await memento.update("key", "value");
        await memento.update("key", undefined);
        expect(memento.get("key", "gone")).toBe("gone");
        expect(memento.keys()).toEqual([]);
    });

    it("keys перечисляет сохранённые ключи", async () => {
        const memento = createExtensionMemento(false);
        await memento.update("a", 1);
        await memento.update("b", 2);
        expect(memento.keys()).toEqual(["a", "b"]);
    });

    it("setKeysForSync есть только у globalState-варианта и не бросает", () => {
        const globalState = createExtensionMemento(true);
        const workspaceState = createExtensionMemento(false);
        expect(workspaceState.setKeysForSync).toBeUndefined();
        expect(() => globalState.setKeysForSync?.(["a"])).not.toThrow();
    });
});
