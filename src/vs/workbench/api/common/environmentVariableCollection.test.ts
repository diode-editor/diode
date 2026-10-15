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

describe("ExtensionContext.environmentVariableCollection (субпроцесс)", () => {
    it("одна коллекция на расширение; без изменений хосту ничего не уходит", () => {
        const { collections, sent } = setup();
        expect(collections.get("a.b")).toBe(collections.get("a.b"));
        expect(collections.get("a.b")).not.toBe(collections.get("c.d"));
        expect(sent()).toEqual([]);
    });

    it("replace/append/prepend — хосту коллекция целиком, мутатор — с типом и опциями по умолчанию", () => {
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

    it("get отдаёт мутатор расширению без переменной и области; неизвестная — undefined", () => {
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

    it("тот же мутатор повторно — без нотификации (Claude Code переставляет порт на каждой активации)", () => {
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

    it("только в shell integration — допустимо (без ошибки), опции как переданы", () => {
        const { collections } = setup();
        const c = collections.get("a.b");
        c.replace("A", "1", { applyAtProcessCreation: false, applyAtShellIntegration: true });
        expect(c.get("A")?.options).toEqual({ applyAtProcessCreation: false, applyAtShellIntegration: true });
    });

    it("смена одного applyAtProcessCreation — новая нотификация", () => {
        const { collections, sent } = setup();
        const c = collections.get("a.b");
        c.replace("A", "1", { applyAtProcessCreation: true, applyAtShellIntegration: true });
        c.replace("A", "1", { applyAtProcessCreation: false, applyAtShellIntegration: true });
        expect(sent()).toHaveLength(2);
        expect(c.get("A")?.options.applyAtProcessCreation).toBe(false);
    });

    it("опции «ни при создании процесса, ни в shell integration» — эталонная ошибка", () => {
        const { collections, sent } = setup();
        expect(() => {
            collections.get("a.b").replace("A", "1", { applyAtProcessCreation: false });
        }).toThrow("EnvironmentVariableMutatorOptions must apply at either process creation or shell integration");
        expect(sent()).toEqual([]);
    });

    it("forEach и итератор — мутаторы своей области; forEach передаёт саму коллекцию и thisArg", () => {
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

    it("getScoped: своя коллекция на папку (по uri), ключ провода — `<переменная>:::<uri>`, область — на проводе", () => {
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

    it("getScoped без папки — та же глобальная коллекция (ключ области пуст, как у эталона)", () => {
        const { collections } = setup();
        const c = collections.get("a.b");
        expect(c.getScoped({})).toBe(c);
    });

    it("delete убирает мутатор; опустевшая коллекция уходит без `collection`", () => {
        const { collections, sent } = setup();
        const c = collections.get("a.b");
        c.replace("A", "1");
        c.delete("A");
        expect(c.get("A")).toBeUndefined();
        expect(sent().at(-1)).toEqual({ extensionId: "a.b", persistent: true, description: [] });
    });

    it("clear без области — всё, с областью — только мутаторы и описание этой папки", () => {
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

    it("description: строка как есть, MarkdownString — до первого абзаца; повтор — без нотификации", () => {
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

    it("description области — с областью на проводе", () => {
        const { collections, sent } = setup();
        collections.get("a.b").getScoped({ workspaceFolder: folder(2) }).description = "d";
        expect(sent().at(-1)?.description).toEqual([
            [
                "file:///w2",
                { description: "d", scope: { workspaceFolder: { uri: "file:///w2", name: "w2", index: 2 } } },
            ],
        ]);
    });

    it("persistent: по умолчанию true, общий для областей, смена уходит хосту", () => {
        const { collections, sent } = setup();
        const c = collections.get("a.b");
        const scoped = c.getScoped({ workspaceFolder: folder(0) });
        expect(c.persistent).toBe(true);
        scoped.persistent = false;
        expect(c.persistent).toBe(false);
        expect(sent().at(-1)?.persistent).toBe(false);
    });

    it("семя с областью без папки (сохранено старой сборкой): обход и clear области его не роняют", () => {
        const { stub, collections } = setup();
        stub.fire("terminal.initEnvironmentVariableCollections", {
            collections: [["a.b", [["E", { variable: "E", value: "e", type: 1, options: {}, scope: {} }]]]],
        });
        const c = collections.get("a.b");
        expect([...c].map(([variable]) => variable)).toEqual(["E"]);
        c.getScoped({ workspaceFolder: folder(0) }).clear();
        expect(c.get("E")?.value).toBe("e");
    });

    it("семя хоста: сохранённая коллекция видна расширению, её правка уходит хосту", () => {
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
