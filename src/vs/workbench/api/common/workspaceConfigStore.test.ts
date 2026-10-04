import { describe, expect, it } from "vitest";

import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

function storeWith(defaults: Record<string, unknown>, user: Record<string, unknown>): WorkspaceConfigStore {
    const store = new WorkspaceConfigStore();
    store.setData({ defaults, user });
    return store;
}

describe("WorkspaceConfigStore", () => {
    it("резолвит dotted-ключ из nested-дерева пользователя", () => {
        const store = storeWith({}, { editor: { tabSize: 2, insertSpaces: false } });
        expect(store.get("editor.tabSize")).toBe(2);
        expect(store.get("editor.insertSpaces")).toBe(false);
    });

    it("пользовательский слой перекрывает дефолты, дефолт без пользовательского значения виден", () => {
        const store = storeWith(
            { editor: { tabSize: 4 }, editorconfig: { generateAuto: true } },
            { editor: { tabSize: 8 } },
        );
        expect(store.get("editor.tabSize")).toBe(8);
        expect(store.get("editorconfig.generateAuto")).toBe(true);
    });

    it("get возвращает defaultValue для отсутствующего ключа", () => {
        const store = new WorkspaceConfigStore();
        expect(store.get("nope.missing", 42)).toBe(42);
        expect(store.get("nope.missing")).toBeUndefined();
    });

    it("has отражает наличие ключа в любом слое", () => {
        const store = storeWith({ editorconfig: { generateAuto: true } }, {});
        expect(store.has("editorconfig.generateAuto")).toBe(true);
        expect(store.has("editorconfig.unknown")).toBe(false);
    });

    it("inspect разделяет default и user слои", () => {
        const result = storeWith({ editor: { tabSize: 4 } }, { editor: { tabSize: 8 } }).inspect("editor.tabSize");
        expect(result).toEqual({ key: "editor.tabSize", defaultValue: 4, globalValue: 8, value: 8 });
    });

    it("inspect для чисто дефолтного ключа не имеет globalValue", () => {
        const result = storeWith({ editorconfig: { generateAuto: true } }, {}).inspect("editorconfig.generateAuto");
        expect(result.defaultValue).toBe(true);
        expect(result.globalValue).toBeUndefined();
        expect(result.value).toBe(true);
    });

    it("sectionKeys перечисляет собственные ключи секции по обоим слоям", () => {
        const store = storeWith(
            { editorconfig: { generateAuto: true } },
            { editor: { tabSize: 2, insertSpaces: true } },
        );
        expect(store.sectionKeys("editor").sort()).toEqual(["insertSpaces", "tabSize"]);
        expect(store.sectionKeys("editorconfig")).toEqual(["generateAuto"]);
        expect(store.sectionKeys(undefined).sort()).toEqual(["editor", "editorconfig"]);
        expect(store.sectionKeys("editor.tabSize")).toEqual([]);
    });

    it("setData заменяет оба слоя целиком", () => {
        const store = storeWith({ a: { x: 1 } }, { editor: { tabSize: 2 } });
        store.setData({ defaults: {}, user: { editor: { insertSpaces: false } } });
        expect(store.get("a.x")).toBeUndefined();
        expect(store.get("editor.tabSize")).toBeUndefined();
        expect(store.get("editor.insertSpaces")).toBe(false);
    });

    it("непонятные данные трактуются как пустые слои", () => {
        const store = storeWith({ a: { x: 1 } }, {});
        store.setData("garbage");
        expect(store.get("a.x")).toBeUndefined();
        store.setData({ defaults: null, user: [1] });
        expect(store.get("a.x")).toBeUndefined();
    });

    it("get по пути, уходящему за скаляр, возвращает undefined", () => {
        expect(storeWith({}, { editor: { tabSize: 2 } }).get("editor.tabSize.deeper")).toBeUndefined();
    });
});
