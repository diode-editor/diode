import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { makeStubRpc } from "./testStubRpc.ts";
import { createTreeViewNoopMembers } from "./treeViewNoop.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";

// Деревья как заглушка: регистрация проходит, дерева нет, в Output — одна
// внятная строка на view. Форма — эталонная (extHostTreeViews.ts).

function makeMembers() {
    const stub = makeStubRpc();
    return { stub, members: createTreeViewNoopMembers(stub.rpc) };
}

function outputLines(
    stub: ReturnType<typeof makeStubRpc>,
): { channel: string; label: string; level: string; value: string }[] {
    return stub.notifies
        .filter((n) => n.method === "output.append")
        .map((n) => n.params as { channel: string; label: string; level: string; value: string });
}

/** Провайдер, который кричит, если его позвали: дерева нет — звать некому. */
function silentProvider(): vscode.TreeDataProvider<string> {
    return {
        getTreeItem: (): never => {
            throw new Error("getTreeItem не должен вызываться");
        },
        getChildren: (): never => {
            throw new Error("getChildren не должен вызываться");
        },
    };
}

describe("treeViewNoop — деревья расширений как заглушка", () => {
    it("registerTreeDataProvider пишет в Output одну warn-строку: главное — в начале", () => {
        const { members, stub } = makeMembers();

        members.registerTreeDataProvider("bazelTaskOutline", silentProvider());

        const lines = outputLines(stub);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toEqual({
            channel: "extensions",
            label: "Extensions",
            level: "warn",
            value: 'дерево "bazelTaskOutline" в TUI пока не рисуется — панели не будет, остальное расширение работает',
        });
    });

    it("повтор того же viewId — без второй строки; другой view — своя строка", () => {
        const { members, stub } = makeMembers();

        members.registerTreeDataProvider("a.view", silentProvider());
        members.createTreeView("a.view", { treeDataProvider: silentProvider() });
        members.registerTreeDataProvider("a.view", silentProvider());
        members.createTreeView("b.view", { treeDataProvider: silentProvider() });

        expect(outputLines(stub).map((l) => l.value)).toEqual([
            expect.stringContaining('"a.view"'),
            expect.stringContaining('"b.view"'),
        ]);
    });

    it("registerTreeDataProvider возвращает Disposable, который можно звать повторно", () => {
        const { members } = makeMembers();

        const disposable = members.registerTreeDataProvider("a.view", silentProvider());

        expect(() => {
            disposable.dispose();
            disposable.dispose();
        }).not.toThrow();
    });

    it("createTreeView возвращает инертный TreeView", async () => {
        const { members, stub } = makeMembers();
        const view = members.createTreeView("a.view", { treeDataProvider: silentProvider(), showCollapseAll: true });
        let fired = 0;
        const count = (): void => {
            fired++;
        };
        view.onDidExpandElement(count);
        view.onDidCollapseElement(count);
        view.onDidChangeSelection(count);
        view.onDidChangeVisibility(count);
        view.onDidChangeCheckboxState(count);

        expect(view.visible).toBe(false);
        expect(view.selection).toEqual([]);
        expect(view.title).toBeUndefined();
        expect(view.message).toBeUndefined();
        expect(view.description).toBeUndefined();
        expect(view.badge).toBeUndefined();

        // Расширения обновляют заголовок и сообщение на каждый рефреш.
        view.title = "Bazel Run Targets";
        view.message = "загрузка…";
        view.description = "3 цели";
        view.badge = { tooltip: "цели", value: 3 };
        expect(view.title).toBe("Bazel Run Targets");
        expect(view.message).toBe("загрузка…");
        expect(view.description).toBe("3 цели");
        expect(view.badge).toEqual({ tooltip: "цели", value: 3 });

        await expect(view.reveal("x", { select: true })).resolves.toBeUndefined();
        view.dispose();
        view.dispose();

        expect(fired).toBe(0);
        // Ничего сверх строки отказа хосту не уходит.
        expect(stub.notifies).toHaveLength(1);
        expect(stub.requests).toHaveLength(0);
    });

    it("createTreeView без treeDataProvider бросает, как эталон, и в Output не пишет", () => {
        const { members, stub } = makeMembers();

        expect(() => members.createTreeView("a.view", {} as vscode.TreeViewOptions<string>)).toThrow(
            "Options with treeDataProvider is mandatory",
        );
        expect(() => members.createTreeView("a.view", undefined as unknown as vscode.TreeViewOptions<string>)).toThrow(
            "Options with treeDataProvider is mandatory",
        );
        expect(() =>
            members.createTreeView("a.view", { treeDataProvider: null } as unknown as vscode.TreeViewOptions<string>),
        ).toThrow("Options with treeDataProvider is mandatory");
        expect(outputLines(stub)).toHaveLength(0);
    });

    it("члены доступны из vscode.window", () => {
        const stub = makeStubRpc();
        const { namespace } = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk());

        const disposable = namespace.window.registerTreeDataProvider("w.view", silentProvider());
        const view = namespace.window.createTreeView("w.view2", { treeDataProvider: silentProvider() });

        expect(typeof disposable.dispose).toBe("function");
        expect(view.visible).toBe(false);
        expect(outputLines(stub)).toHaveLength(2);
    });
});
