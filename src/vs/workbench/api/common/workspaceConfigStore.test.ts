import { describe, expect, it } from "vitest";

import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

function storeWith(defaults: Record<string, unknown>, user: Record<string, unknown>): WorkspaceConfigStore {
    const store = new WorkspaceConfigStore();
    store.setData({ defaults, user });
    return store;
}

describe("WorkspaceConfigStore", () => {
    it("resolves a dotted key from the user's nested tree", () => {
        const store = storeWith({}, { editor: { tabSize: 2, insertSpaces: false } });
        expect(store.get("editor.tabSize")).toBe(2);
        expect(store.get("editor.insertSpaces")).toBe(false);
    });

    it("the user layer overrides defaults, a default without a user value is visible", () => {
        const store = storeWith(
            { editor: { tabSize: 4 }, editorconfig: { generateAuto: true } },
            { editor: { tabSize: 8 } },
        );
        expect(store.get("editor.tabSize")).toBe(8);
        expect(store.get("editorconfig.generateAuto")).toBe(true);
    });

    it("get returns defaultValue for a missing key", () => {
        const store = new WorkspaceConfigStore();
        expect(store.get("nope.missing", 42)).toBe(42);
        expect(store.get("nope.missing")).toBeUndefined();
    });

    it("has reflects a key present in any layer", () => {
        const store = storeWith({ editorconfig: { generateAuto: true } }, {});
        expect(store.has("editorconfig.generateAuto")).toBe(true);
        expect(store.has("editorconfig.unknown")).toBe(false);
    });

    it("inspect separates the default and user layers", () => {
        const result = storeWith({ editor: { tabSize: 4 } }, { editor: { tabSize: 8 } }).inspect("editor.tabSize");
        expect(result).toEqual({
            key: "editor.tabSize",
            defaultValue: 4,
            globalValue: 8,
            workspaceValue: undefined,
            value: 8,
        });
    });

    it("inspect of a default-only key has no globalValue", () => {
        const result = storeWith({ editorconfig: { generateAuto: true } }, {}).inspect("editorconfig.generateAuto");
        expect(result.defaultValue).toBe(true);
        expect(result.globalValue).toBeUndefined();
        expect(result.value).toBe(true);
    });

    it("sectionKeys lists the section's own keys across both layers", () => {
        const store = storeWith(
            { editorconfig: { generateAuto: true } },
            { editor: { tabSize: 2, insertSpaces: true } },
        );
        expect(store.sectionKeys("editor").sort()).toEqual(["insertSpaces", "tabSize"]);
        expect(store.sectionKeys("editorconfig")).toEqual(["generateAuto"]);
        expect(store.sectionKeys(undefined).sort()).toEqual(["editor", "editorconfig"]);
        expect(store.sectionKeys("editor.tabSize")).toEqual([]);
    });

    it("setData replaces both layers entirely", () => {
        const store = storeWith({ a: { x: 1 } }, { editor: { tabSize: 2 } });
        store.setData({ defaults: {}, user: { editor: { insertSpaces: false } } });
        expect(store.get("a.x")).toBeUndefined();
        expect(store.get("editor.tabSize")).toBeUndefined();
        expect(store.get("editor.insertSpaces")).toBe(false);
    });

    it("unrecognized data is treated as empty layers", () => {
        const store = storeWith({ a: { x: 1 } }, {});
        store.setData("garbage");
        expect(store.get("a.x")).toBeUndefined();
        store.setData({ defaults: null, user: [1] });
        expect(store.get("a.x")).toBeUndefined();
    });

    it("languageId selects the language section in all reads", () => {
        const store = storeWith(
            { editor: { tabSize: 4 }, "[makefile]": { editor: { insertSpaces: false } } },
            { "[makefile]": { editor: { tabSize: 8 } } },
        );

        expect(store.get("editor.tabSize")).toBe(4);
        expect(store.get("editor.tabSize", undefined, "makefile")).toBe(8);
        expect(store.has("editor.insertSpaces", "makefile")).toBe(true);
        expect(store.has("editor.insertSpaces")).toBe(false);
        expect(store.inspect("editor.insertSpaces", "makefile").value).toBe(false);
        expect(store.sectionKeys("editor", "makefile").sort()).toEqual(["insertSpaces", "tabSize"]);
    });

    it("get with a path going past a scalar returns undefined", () => {
        expect(storeWith({}, { editor: { tabSize: 2 } }).get("editor.tabSize.deeper")).toBeUndefined();
    });
});

describe("WorkspaceConfigStore — workspace layer", () => {
    it("overrides user; inspect returns workspaceValue; the workspace language section applies", () => {
        const store = new WorkspaceConfigStore();
        store.setData({
            defaults: { editor: { tabSize: 4 } },
            user: { editor: { tabSize: 8 }, bazel: { projectview: { open: true } } },
            workspace: { bazel: { projectview: { open: false } }, "[java]": { editor: { tabSize: 2 } } },
        });

        expect(store.get("bazel.projectview.open")).toBe(false);
        expect(store.get("editor.tabSize")).toBe(8);
        expect(store.get("editor.tabSize", undefined, "java")).toBe(2);
        expect(store.inspect("bazel.projectview.open")).toEqual({
            key: "bazel.projectview.open",
            defaultValue: undefined,
            globalValue: true,
            workspaceValue: false,
            value: false,
        });
    });

    it("the folder layer overrides the workspace; inspect returns workspaceFolderValue; the language section applies", () => {
        const store = new WorkspaceConfigStore();
        store.setData({
            defaults: { editor: { tabSize: 4 } },
            user: {},
            workspace: { editor: { tabSize: 2 } },
            workspaceFolder: { editor: { tabSize: 8 }, "[go]": { editor: { tabSize: 3 } } },
        });

        expect(store.get("editor.tabSize")).toBe(8);
        expect(store.get("editor.tabSize", undefined, "go")).toBe(3);
        expect(store.inspect("editor.tabSize")).toEqual({
            key: "editor.tabSize",
            defaultValue: 4,
            globalValue: undefined,
            workspaceValue: 2,
            workspaceFolderValue: 8,
            value: 8,
        });
        expect(store.hasLanguageOverride("editor.tabSize", "go", "workspaceFolder")).toBe(true);
        expect(store.hasLanguageOverride("editor.tabSize", "go", "workspace")).toBe(false);
    });

    it("without workspace in the data (old host, empty window) the layer is empty", () => {
        const store = storeWith({}, { editor: { tabSize: 8 } });
        expect(store.inspect("editor.tabSize").workspaceValue).toBeUndefined();
        expect(store.get("editor.tabSize")).toBe(8);
    });
});
