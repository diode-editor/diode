import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { ExtHostEnvironmentVariableCollections } from "./environmentVariableCollection.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { EnvironmentVariableMutatorType, MarkdownString, Uri } from "./vscodeTypes.ts";
import type { IWireSetEnvironmentVariableCollection } from "./wireTypes.ts";

function setup() {
    const stub = makeStubRpc();
    const collections = new ExtHostEnvironmentVariableCollections(stub.rpc);
    const sent = (): IWireSetEnvironmentVariableCollection[] =>
        stub.notifies
            .filter((n) => n.method === "terminal.setEnvironmentVariableCollection")
            .map((n) => n.params as IWireSetEnvironmentVariableCollection);
    return { stub, collections, sent };
}

const folder = (index: number): vscode.WorkspaceFolder => ({
    uri: Uri.file(`/w${index}`),
    name: `w${index}`,
    index,
});

describe("ExtensionContext.environmentVariableCollection (subprocess)", () => {
    it("one collection per extension; nothing is sent to the host without changes", () => {
        const { collections, sent } = setup();
        expect(collections.get("a.b")).toBe(collections.get("a.b"));
        expect(collections.get("a.b")).not.toBe(collections.get("c.d"));
        expect(sent()).toEqual([]);
    });

    it("replace/append/prepend send the whole collection to the host, mutator has type and default options", () => {
        const { collections, sent } = setup();
        const c = collections.get("a.b");
        c.replace("A", "1");
        c.append("B", "2");
        c.prepend("C", "3");
        expect(sent()).toHaveLength(3);
        expect(sent().at(-1)).toStrictEqual({
            extensionId: "a.b",
            persistent: true,
            collection: [
                ["A", { variable: "A", value: "1", type: 1, options: { applyAtProcessCreation: true } }],
                ["B", { variable: "B", value: "2", type: 2, options: { applyAtProcessCreation: true } }],
                ["C", { variable: "C", value: "3", type: 3, options: { applyAtProcessCreation: true } }],
            ],
            description: [],
        });
    });

    it("get returns the mutator without variable and scope; unknown yields undefined", () => {
        const { collections } = setup();
        const c = collections.get("a.b");
        c.append("PATH", ":/x", { applyAtShellIntegration: true });
        expect(c.get("PATH")).toEqual({
            type: EnvironmentVariableMutatorType.Append,
            value: ":/x",
            options: { applyAtProcessCreation: false, applyAtShellIntegration: true },
        });
        expect(c.get("NOPE")).toBeUndefined();
    });

    it("same mutator again sends no notification (Claude Code resets the port on every activation)", () => {
        const { collections, sent } = setup();
        const c = collections.get("a.b");
        c.replace("P", "1");
        c.replace("P", "1");
        expect(sent()).toHaveLength(1);
        c.replace("P", "2");
        c.append("P", "2");
        c.append("P", "2", { applyAtProcessCreation: true });
        c.append("P", "2", { applyAtProcessCreation: true, applyAtShellIntegration: true });
        expect(sent()).toHaveLength(5);
    });

    it("shell integration only is allowed (no error), options as passed", () => {
        const { collections } = setup();
        const c = collections.get("a.b");
        c.replace("A", "1", { applyAtProcessCreation: false, applyAtShellIntegration: true });
        expect(c.get("A")?.options).toEqual({ applyAtProcessCreation: false, applyAtShellIntegration: true });
    });

    it("changing only applyAtProcessCreation sends a new notification", () => {
        const { collections, sent } = setup();
        const c = collections.get("a.b");
        c.replace("A", "1", { applyAtProcessCreation: true, applyAtShellIntegration: true });
        c.replace("A", "1", { applyAtProcessCreation: false, applyAtShellIntegration: true });
        expect(sent()).toHaveLength(2);
        expect(c.get("A")?.options.applyAtProcessCreation).toBe(false);
    });

    it("options 'neither at process creation nor in shell integration' throw the upstream error", () => {
        const { collections, sent } = setup();
        expect(() => {
            collections.get("a.b").replace("A", "1", { applyAtProcessCreation: false });
        }).toThrow("EnvironmentVariableMutatorOptions must apply at either process creation or shell integration");
        expect(sent()).toEqual([]);
    });

    it("forEach and iterator yield mutators of their scope; forEach passes the collection itself and thisArg", () => {
        const { collections } = setup();
        const c = collections.get("a.b");
        c.replace("A", "1");
        c.getScoped({ workspaceFolder: folder(0) }).replace("S", "s");
        const seen: unknown[] = [];
        const self = { tag: "this" };
        c.forEach(function (this: unknown, variable, mutator, collection) {
            seen.push([variable, mutator.value, collection === c, this]);
        }, self);
        expect(seen).toEqual([["A", "1", true, self]]);
        expect([...c].map(([variable]) => variable)).toEqual(["A"]);
        expect([...c.getScoped({ workspaceFolder: folder(0) })].map(([variable]) => variable)).toEqual(["S"]);
    });

    it("getScoped: own collection per folder (by uri), wire key is `<variable>:::<uri>`, scope is on the wire", () => {
        const { collections, sent } = setup();
        const c = collections.get("a.b");
        const scoped = c.getScoped({ workspaceFolder: folder(1) });
        expect(c.getScoped({ workspaceFolder: folder(1) })).toBe(scoped);
        scoped.replace("V", "v");
        expect(sent().at(-1)?.collection).toEqual([
            [
                "V:::file:///w1",
                {
                    variable: "V",
                    value: "v",
                    type: 1,
                    options: { applyAtProcessCreation: true },
                    scope: { workspaceFolder: { uri: "file:///w1", name: "w1", index: 1 } },
                },
            ],
        ]);
        expect(scoped.get("V")?.value).toBe("v");
        expect(c.get("V")).toBeUndefined();
    });

    it("getScoped without a folder is the same global collection (empty scope key, as upstream)", () => {
        const { collections } = setup();
        const c = collections.get("a.b");
        expect(c.getScoped({})).toBe(c);
    });

    it("delete removes the mutator; an emptied collection is sent without `collection`", () => {
        const { collections, sent } = setup();
        const c = collections.get("a.b");
        c.replace("A", "1");
        c.delete("A");
        expect(c.get("A")).toBeUndefined();
        expect(sent().at(-1)).toEqual({ extensionId: "a.b", persistent: true, description: [] });
    });

    it("clear without scope drops everything, with scope only that folder's mutators and description", () => {
        const { collections, sent } = setup();
        const c = collections.get("a.b");
        const s0 = c.getScoped({ workspaceFolder: folder(0) });
        const s1 = c.getScoped({ workspaceFolder: folder(1) });
        c.replace("G", "g");
        s0.replace("A", "a");
        s1.replace("B", "b");
        s0.description = "zero";
        s1.description = "one";
        s0.clear();
        expect(s0.get("A")).toBeUndefined();
        expect(s0.description).toBeUndefined();
        expect(s1.get("B")?.value).toBe("b");
        expect(s1.description).toBe("one");
        expect(c.get("G")?.value).toBe("g");
        c.description = "global";
        const before = sent().length;
        c.clear();
        expect(sent()).toHaveLength(before + 1);
        expect(c.get("G")).toBeUndefined();
        expect(s1.get("B")).toBeUndefined();
        expect(s1.description).toBeUndefined();
        expect(c.description).toBeUndefined();
    });

    it("description: string as is, MarkdownString up to the first paragraph; repeat sends no notification", () => {
        const { collections, sent } = setup();
        const c = collections.get("a.b");
        c.description = "Adds tools to PATH";
        expect(c.description).toBe("Adds tools to PATH");
        expect(sent().at(-1)?.description).toEqual([["", { description: "Adds tools to PATH", scope: undefined }]]);
        c.description = "Adds tools to PATH";
        expect(sent()).toHaveLength(1);
        c.description = new MarkdownString("**first**\n\nsecond");
        expect(c.description).toBe("**first**");
        c.description = undefined;
        expect(c.description).toBeUndefined();
        expect(sent()).toHaveLength(3);
    });

    it("scoped description carries the scope on the wire", () => {
        const { collections, sent } = setup();
        collections.get("a.b").getScoped({ workspaceFolder: folder(2) }).description = "d";
        expect(sent().at(-1)?.description).toEqual([
            [
                "file:///w2",
                { description: "d", scope: { workspaceFolder: { uri: "file:///w2", name: "w2", index: 2 } } },
            ],
        ]);
    });

    it("persistent: true by default, shared across scopes, change is sent to the host", () => {
        const { collections, sent } = setup();
        const c = collections.get("a.b");
        const scoped = c.getScoped({ workspaceFolder: folder(0) });
        expect(c.persistent).toBe(true);
        scoped.persistent = false;
        expect(c.persistent).toBe(false);
        expect(sent().at(-1)?.persistent).toBe(false);
    });

    it("seed with a folderless scope (saved by an old build): iteration and scoped clear do not crash on it", () => {
        const { stub, collections } = setup();
        stub.fire("terminal.initEnvironmentVariableCollections", {
            collections: [["a.b", [["E", { variable: "E", value: "e", type: 1, options: {}, scope: {} }]]]],
        });
        const c = collections.get("a.b");
        expect([...c].map(([variable]) => variable)).toEqual(["E"]);
        c.getScoped({ workspaceFolder: folder(0) }).clear();
        expect(c.get("E")?.value).toBe("e");
    });

    it("host seed: saved collection is visible to the extension, its edit is sent to the host", () => {
        const { stub, collections, sent } = setup();
        stub.fire("terminal.initEnvironmentVariableCollections", {
            collections: [
                ["a.b", [["P", { variable: "P", value: "5", type: 1, options: { applyAtProcessCreation: true } }]]],
            ],
        });
        const c = collections.get("a.b");
        expect(c.get("P")?.value).toBe("5");
        c.replace("P", "5");
        expect(sent()).toEqual([]);
        c.replace("P", "6");
        expect(sent().at(-1)?.collection).toEqual([
            ["P", { variable: "P", value: "6", type: 1, options: { applyAtProcessCreation: true } }],
        ]);
    });
});
