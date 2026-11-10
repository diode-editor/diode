import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { createExtHostTreeViews } from "./extHostTreeViews.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner } from "./vscodeHostContext.ts";
import { EventEmitter, TreeItem, TreeItemCollapsibleState } from "./vscodeTypes.ts";

interface INode {
    readonly item: vscode.TreeItem;
    children?: INode[];
    parent?: INode;
}

function node(item: vscode.TreeItem | string, children?: INode[]): INode {
    const treeItem =
        typeof item === "string"
            ? new TreeItem(
                  item,
                  children === undefined ? TreeItemCollapsibleState.None : TreeItemCollapsibleState.Collapsed,
              )
            : item;
    const created: INode = { item: treeItem, children };
    for (const child of children ?? []) child.parent = created;
    return created;
}

function setup() {
    const stub = makeStubRpc();
    const owner = new ExtensionOwner();
    const members = createExtHostTreeViews(stub.rpc, { executeCommand: () => Promise.resolve(), owner });
    const create = (p: vscode.TreeDataProvider<INode>) =>
        owner.runAs("pub.ext", () => members.createTreeView("v", { treeDataProvider: p }));
    const reveals = () => stub.requests.filter((r) => r.method === "treeView.reveal");
    const children = () => stub.callRequest("treeView.getChildren", { viewId: "v" });
    return { stub, create, reveals, children };
}

describe("TreeView.reveal edges (tester)", () => {
    it("rejects when the element's own getTreeItem throws, as upstream", async () => {
        const { create, reveals } = setup();
        const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const ghost = node("ghost");
        const view = create({
            getTreeItem: (e) => {
                if (e === ghost) throw new Error("item boom");
                return e.item;
            },
            getChildren: () => [],
            getParent: () => undefined,
        });
        await expect(view.reveal(ghost)).rejects.toThrow("item boom");
        expect(reveals()).toEqual([]);
        err.mockRestore();
    });

    it("an ancestor whose getTreeItem throws is only logged", async () => {
        const { create, reveals } = setup();
        const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const leaf = node("leaf");
        const top = node("top", [leaf]);
        const view = create({
            getTreeItem: (e) => {
                if (e === top) throw new Error("ancestor boom");
                return e.item;
            },
            getChildren: (e) => (e === undefined ? [top] : (e.children ?? [])),
            getParent: (e) => e.parent,
        });
        await expect(view.reveal(leaf)).resolves.toBeUndefined();
        expect(reveals()).toEqual([]);
        expect(err).toHaveBeenCalled();
        err.mockRestore();
    });

    it("rejects when the main thread's reveal fails, as upstream", async () => {
        const { stub, create } = setup();
        stub.responder = (method) =>
            method === "treeView.reveal" ? Promise.reject(new Error("host boom")) : undefined;
        const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const top = node("top");
        const view = create({
            getTreeItem: (e) => e.item,
            getChildren: (e) => (e ? [] : [top]),
            getParent: () => undefined,
        });
        await expect(view.reveal(top)).rejects.toThrow("host boom");
        err.mockRestore();
    });

    it("an element dropped by a refresh rejects on reveal", async () => {
        const { create, children, reveals } = setup();
        const changed = new EventEmitter<INode | undefined>();
        const a = node(Object.assign(new TreeItem("a"), { id: "a" }));
        const b = node(Object.assign(new TreeItem("b"), { id: "b" }));
        let roots = [a, b];
        const view = create({
            onDidChangeTreeData: changed.event,
            getTreeItem: (e) => e.item,
            getChildren: (e) => (e ? [] : roots),
            getParent: () => undefined,
        });
        await children();
        roots = [a];
        changed.fire(undefined);
        await children();
        await expect(view.reveal(b)).rejects.toThrow("Cannot resolve tree item for element 1/b from extension pub.ext");
        expect(reveals()).toEqual([]);
    });

    it("keeps a unicode id verbatim in the message", async () => {
        const { create } = setup();
        const view = create({ getTreeItem: (e) => e.item, getChildren: () => [], getParent: () => undefined });
        const ghost = node(Object.assign(new TreeItem("x"), { id: "файл 🚀" }));
        await expect(view.reveal(ghost)).rejects.toThrow(
            new Error("Cannot resolve tree item for element 1/файл 🚀 from extension pub.ext"),
        );
    });

    it("a resolvable element after a rejected reveal still reveals", async () => {
        const { create, reveals } = setup();
        const top = node("top");
        const view = create({
            getTreeItem: (e) => e.item,
            getChildren: (e) => (e ? [] : [top]),
            getParent: () => undefined,
        });
        await expect(view.reveal(node("ghost"))).rejects.toThrow(/Cannot resolve tree item/);
        await view.reveal(top);
        expect(reveals()).toHaveLength(1);
    });
});
