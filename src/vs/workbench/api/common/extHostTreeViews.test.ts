import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { createExtHostTreeViews, type ITreeViewMembers, TREE_REFRESH_DELAY_MS } from "./extHostTreeViews.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import type { IWireTreeItem } from "./treeViewWireTypes.ts";
import { ExtensionOwner } from "./vscodeHostContext.ts";
import {
    EventEmitter,
    MarkdownString,
    ThemeColor,
    ThemeIcon,
    TreeItem,
    TreeItemCollapsibleState,
    Uri,
} from "./vscodeTypes.ts";

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

function labelOf(element: INode): string {
    return typeof element.item.label === "string" ? element.item.label : "";
}

function provider(
    roots: () => INode[],
    withParent = false,
): vscode.TreeDataProvider<INode> & {
    readonly changed: EventEmitter<INode | INode[] | undefined | null>;
} {
    const changed = new EventEmitter<INode | INode[] | undefined | null>();
    return {
        changed,
        onDidChangeTreeData: changed.event,
        getTreeItem: (element) => element.item,
        getChildren: (element) => (element === undefined ? roots() : (element.children ?? [])),
        ...(withParent ? { getParent: (element: INode) => element.parent } : {}),
    };
}

interface ISetup {
    readonly stub: IStubRpc;
    readonly members: ITreeViewMembers;
    readonly executed: unknown[][];
    children(parentHandle?: string, viewId?: string): Promise<IWireTreeItem[]>;
}

function setup(owner?: ExtensionOwner): ISetup {
    const stub = makeStubRpc();
    const executed: unknown[][] = [];
    const members = createExtHostTreeViews(stub.rpc, {
        executeCommand: (id, ...args) => {
            executed.push([id, ...args]);
            return Promise.resolve();
        },
        ...(owner === undefined ? {} : { owner }),
    });
    return {
        stub,
        members,
        executed,
        children: (parentHandle, viewId = "v") =>
            stub.callRequest("treeView.getChildren", {
                viewId,
                ...(parentHandle === undefined ? {} : { parentHandle }),
            }) as Promise<IWireTreeItem[]>,
    };
}

function notifications(stub: IStubRpc, method: string): unknown[] {
    return stub.notifies.filter((n) => n.method === method).map((n) => n.params);
}

function requests(stub: IStubRpc, method: string): unknown[] {
    return stub.requests.filter((r) => r.method === method).map((r) => r.params);
}

describe("extHostTreeViews — registration", () => {
    it("createTreeView without a provider throws upstream's message", () => {
        const { members } = setup();
        expect(() => members.createTreeView("v", undefined as unknown as vscode.TreeViewOptions<unknown>)).toThrow(
            "Options with treeDataProvider is mandatory",
        );
        expect(() => members.createTreeView("v", {} as vscode.TreeViewOptions<unknown>)).toThrow(
            "Options with treeDataProvider is mandatory",
        );
        expect(() =>
            members.createTreeView("v", { treeDataProvider: null } as unknown as vscode.TreeViewOptions<unknown>),
        ).toThrow("Options with treeDataProvider is mandatory");
    });

    it("tells the host the view, its options and the owner", () => {
        const owner = new ExtensionOwner();
        const { members, stub } = setup(owner);
        owner.runAs("pub.ext", () =>
            members.createTreeView("v", {
                treeDataProvider: provider(() => []),
                showCollapseAll: true,
                canSelectMany: true,
            }),
        );
        members.registerTreeDataProvider(
            "w",
            provider(() => []),
        );
        expect(notifications(stub, "treeView.register")).toEqual([
            { viewId: "v", showCollapseAll: true, canSelectMany: true, extensionId: "pub.ext" },
            { viewId: "w", showCollapseAll: false, canSelectMany: false },
        ]);
    });

    it("registerTreeDataProvider's dispose frees the view", async () => {
        const { members, stub, children } = setup();
        const disposable = members.registerTreeDataProvider(
            "v",
            provider(() => [node("a")]),
        );
        disposable.dispose();
        expect(notifications(stub, "treeView.dispose")).toEqual([{ viewId: "v" }]);
        await expect(children()).rejects.toThrow("No tree view with id 'v' registered.");
    });

    it("a repeated registration answers from the new provider; the old dispose leaves it alone", async () => {
        const { members, stub, children } = setup();
        const first = members.createTreeView("v", { treeDataProvider: provider(() => [node("old")]) });
        members.createTreeView("v", { treeDataProvider: provider(() => [node("new")]) });
        first.dispose();
        expect(notifications(stub, "treeView.dispose")).toEqual([]);
        expect((await children()).map((item) => item.label)).toEqual(["new"]);
    });

    it("requests for an unknown view reject; notifications for it are ignored", async () => {
        const { stub } = setup();
        await expect(stub.callRequest("treeView.executeCommand", { viewId: "x", handle: "h" })).rejects.toThrow(
            "No tree view with id 'x' registered.",
        );
        expect(() => {
            stub.fire("treeView.setVisible", { viewId: "x", visible: true });
            stub.fire("treeView.setExpanded", { viewId: "x", handle: "h", expanded: true });
            stub.fire("treeView.setSelection", { viewId: "x", handles: [] });
        }).not.toThrow();
    });
});

describe("extHostTreeViews — rows", () => {
    it("serializes a TreeItem as upstream: label, description, state, ThemeIcon, resource, context, command", async () => {
        const { members, children } = setup();
        const full = new TreeItem("full", TreeItemCollapsibleState.Expanded);
        full.description = "desc";
        full.iconPath = new ThemeIcon("package", new ThemeColor("charts.red"));
        full.resourceUri = Uri.file("/w/a.ts");
        full.contextValue = "ctx";
        full.command = { command: "x.run", title: "Run", arguments: [1] };
        const bare = new TreeItem("bare");
        bare.description = false;
        bare.iconPath = Uri.file("/icons/a.svg");
        bare.collapsibleState = undefined;
        const pathOnly = new TreeItem("path");
        pathOnly.description = true;
        pathOnly.iconPath = new ThemeIcon("play");
        members.createTreeView("v", { treeDataProvider: provider(() => [node(full), node(bare), node(pathOnly)]) });
        expect(await children()).toEqual([
            {
                handle: "0/0:full",
                label: "full",
                description: "desc",
                collapsibleState: 2,
                themeIcon: { id: "package", color: "charts.red" },
                resourceUri: "file:///w/a.ts",
                contextValue: "ctx",
                command: { id: "x.run", title: "Run" },
            },
            { handle: "0/0:bare", label: "bare", collapsibleState: 0 },
            { handle: "0/0:path", label: "path", description: true, collapsibleState: 0, themeIcon: { id: "play" } },
        ]);
    });

    it("the label is a TreeItemLabel's text, a MarkdownString's source, or the resource's name", async () => {
        const { members, children } = setup();
        const labelled = new TreeItem({ label: "from label", highlights: [[0, 4]] });
        const markdown = new TreeItem({ label: new MarkdownString("**md**") as unknown as string });
        const odd = new TreeItem({ label: 42 as unknown as string });
        const resource = new TreeItem(Uri.file("/w/dir/file.txt"));
        const nothing = new TreeItem("");
        const weird = new TreeItem(null as unknown as string);
        members.createTreeView("v", {
            treeDataProvider: provider(() =>
                [labelled, markdown, odd, resource, nothing, weird].map((item) => node(item)),
            ),
        });
        expect((await children()).map((item) => [item.handle, item.label])).toEqual([
            ["0/0:from label", "from label"],
            ["0/0:**md**", "**md**"],
            ["0/0:", ""],
            ["0/0:file.txt", "file.txt"],
            ["0/1:", ""],
            ["0/2:", ""],
        ]);
    });

    it("an invalid child under a parent is retried on the next request", async () => {
        const { members, children } = setup();
        let invalid = true;
        const parent = node("p", [node("c")]);
        members.createTreeView("v", {
            treeDataProvider: {
                getTreeItem: (element: INode) =>
                    element === parent || !invalid ? element.item : (null as unknown as TreeItem),
                getChildren: (element?: INode) => (element === undefined ? [parent] : (element.children ?? [])),
            },
        });
        await children();
        await expect(children("0/0:p")).rejects.toThrow("invalid tree item");
        invalid = false;
        expect((await children("0/0:p")).map((item) => item.label)).toEqual(["c"]);
    });

    it("handles are `1/<id>`, or the label with a counter among same-named siblings, under the parent's handle", async () => {
        const { members, children } = setup();
        const withId = new TreeItem("x");
        withId.id = "stable";
        const emptyId = new TreeItem("y");
        emptyId.id = "";
        const parent = node("a/b", [node("c"), node("c")]);
        members.createTreeView("v", { treeDataProvider: provider(() => [node(withId), node(emptyId), parent]) });
        expect((await children()).map((item) => item.handle)).toEqual(["1/stable", "0/0:y", "0/0:a//b"]);
        expect((await children("0/0:a//b")).map((item) => [item.handle, item.parentHandle])).toEqual([
            ["0/0:a//b/0:c", "0/0:a//b"],
            ["0/0:a//b/1:c", "0/0:a//b"],
        ]);
    });

    it("children come from the cache until a refresh clears it", async () => {
        let calls = 0;
        const { members, children } = setup();
        const p = provider(() => {
            calls++;
            return [node("a")];
        });
        members.createTreeView("v", { treeDataProvider: p });
        await children();
        await children();
        expect(calls).toBe(1);
    });

    it("an unknown parent handle is an empty answer", async () => {
        const { members, children } = setup();
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        members.createTreeView("v", { treeDataProvider: provider(() => [node("a")]) });
        expect(await children("nope")).toEqual([]);
        expect(error).toHaveBeenCalledWith("[tree view v] No tree item with id 'nope' found.");
        error.mockRestore();
    });

    it("null and undefined children are dropped; a null answer is no children", async () => {
        const { members, children } = setup();
        members.createTreeView("v", {
            treeDataProvider: {
                getTreeItem: (element: string) => new TreeItem(element),
                getChildren: (element?: string) =>
                    element === undefined ? (["a", null, undefined, "b"] as unknown as string[]) : null,
            },
        });
        expect((await children()).map((item) => item.label)).toEqual(["a", "b"]);
        expect(await children("0/0:a")).toEqual([]);
    });

    it("getChildren and getTreeItem failures reject the request; an invalid item does too", async () => {
        const { members, children } = setup();
        let mode: "throw" | "item" | "invalid" = "throw";
        members.createTreeView("v", {
            treeDataProvider: {
                getTreeItem: (element: string) => {
                    if (mode === "item") throw new Error("item failed");
                    return (mode === "invalid" ? null : new TreeItem(element))!;
                },
                getChildren: () => {
                    if (mode === "throw") throw new Error("children failed");
                    return ["a"];
                },
            },
        });
        await expect(children()).rejects.toThrow("children failed");
        mode = "item";
        await expect(children()).rejects.toThrow("item failed");
        mode = "invalid";
        await expect(children()).rejects.toThrow("Tree view v has provided an invalid tree item.");
        mode = "ok" as typeof mode;
        expect((await children()).map((item) => item.label)).toEqual(["a"]);
    });

    it("executeCommand runs the row's command with its own arguments; a row without one does nothing", async () => {
        const { members, children, stub, executed } = setup();
        const target = { kind: "target" };
        const runnable = new TreeItem("run");
        runnable.command = { command: "x.run", title: "Run", arguments: [target, 2] };
        const noArgs = new TreeItem("noargs");
        noArgs.command = { command: "x.plain", title: "Plain" };
        members.createTreeView("v", { treeDataProvider: provider(() => [node(runnable), node(noArgs), node("idle")]) });
        await children();
        await stub.callRequest("treeView.executeCommand", { viewId: "v", handle: "0/0:run" });
        await stub.callRequest("treeView.executeCommand", { viewId: "v", handle: "0/0:noargs" });
        await stub.callRequest("treeView.executeCommand", { viewId: "v", handle: "0/0:idle" });
        await stub.callRequest("treeView.executeCommand", { viewId: "v", handle: "0/0:gone" });
        expect(executed).toEqual([["x.run", target, 2], ["x.plain"]]);
        expect(executed[0][1]).toBe(target);
    });
});

describe("extHostTreeViews — TreeView state", () => {
    it("visible, expansion and selection follow the host, each change once", async () => {
        const { members, children, stub } = setup();
        const a = node("a", [node("a1")]);
        const b = node("b");
        const view = members.createTreeView("v", { treeDataProvider: provider(() => [a, b]) });
        const events: string[] = [];
        view.onDidChangeVisibility((e) => events.push(`visible:${e.visible}`));
        view.onDidExpandElement((e) => events.push(`expand:${labelOf(e.element)}`));
        view.onDidCollapseElement((e) => events.push(`collapse:${labelOf(e.element)}`));
        view.onDidChangeSelection((e) => events.push(`selection:${e.selection.map(labelOf).join(",")}`));
        await children();
        expect(view.visible).toBe(false);
        stub.fire("treeView.setVisible", { viewId: "v", visible: true });
        stub.fire("treeView.setVisible", { viewId: "v", visible: true });
        stub.fire("treeView.setExpanded", { viewId: "v", handle: "0/0:a", expanded: true });
        stub.fire("treeView.setExpanded", { viewId: "v", handle: "0/0:a", expanded: false });
        stub.fire("treeView.setExpanded", { viewId: "v", handle: "nope", expanded: true });
        stub.fire("treeView.setSelection", { viewId: "v", handles: ["0/0:a", "0/0:b", "gone"] });
        stub.fire("treeView.setSelection", { viewId: "v", handles: ["0/0:a", "0/0:b", "gone"] });
        stub.fire("treeView.setSelection", { viewId: "v", handles: ["0/0:b", "0/0:a", "gone"] });
        stub.fire("treeView.setSelection", { viewId: "v", handles: ["0/0:b"] });
        expect(view.visible).toBe(true);
        expect(view.selection).toEqual([b]);
        expect(events).toEqual([
            "visible:true",
            "expand:a",
            "collapse:a",
            "selection:a,b",
            "selection:b,a",
            "selection:b",
        ]);
    });

    it("title, description and message go to the host; badge is kept", () => {
        const { members, stub } = setup();
        const view = members.createTreeView("v", { treeDataProvider: provider(() => []) });
        expect(view.title).toBeUndefined();
        view.title = "Title";
        view.description = "desc";
        view.title = undefined;
        view.message = "hello";
        view.message = new MarkdownString("**md**") as unknown as string;
        view.message = undefined;
        view.badge = { value: 3, tooltip: "three" };
        expect(view.description).toBe("desc");
        expect(view.message).toBe("");
        expect(view.badge).toEqual({ value: 3, tooltip: "three" });
        expect(notifications(stub, "treeView.setTitle")).toEqual([
            { viewId: "v", title: "Title" },
            { viewId: "v", title: "Title", description: "desc" },
            { viewId: "v", description: "desc" },
        ]);
        expect(notifications(stub, "treeView.setMessage")).toEqual([
            { viewId: "v", message: "hello" },
            { viewId: "v", message: "**md**" },
            { viewId: "v", message: "" },
        ]);
    });

    it("dispose silences the events and further changes", async () => {
        const { members, stub, children } = setup();
        const p = provider(() => [node("a")]);
        const view = members.createTreeView("v", { treeDataProvider: p });
        await children();
        const events: string[] = [];
        view.onDidChangeVisibility(() => events.push("visible"));
        view.dispose();
        view.dispose();
        p.changed.fire(undefined);
        await Promise.resolve();
        expect(events).toEqual([]);
        expect(requests(stub, "treeView.refresh")).toEqual([]);
        expect(notifications(stub, "treeView.dispose")).toEqual([{ viewId: "v" }]);
    });
});

describe("extHostTreeViews — refresh", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    async function drain(): Promise<void> {
        for (let i = 0; i < 10; i++) await Promise.resolve();
    }

    it("fire() clears the cache and rereads the root; the first change goes at once", async () => {
        let roots = [node("a")];
        const { members, stub, children } = setup();
        const p = provider(() => roots);
        members.createTreeView("v", { treeDataProvider: p });
        await children();
        roots = [node("b")];
        p.changed.fire(undefined);
        await drain();
        expect(requests(stub, "treeView.refresh")).toEqual([{ viewId: "v" }]);
        expect((await children()).map((item) => item.label)).toEqual(["b"]);
    });

    it("fire(null) is the root too; fire([]) is nothing", async () => {
        const { members, stub, children } = setup();
        const p = provider(() => [node("a")]);
        members.createTreeView("v", { treeDataProvider: p });
        await children();
        p.changed.fire([]);
        await drain();
        expect(requests(stub, "treeView.refresh")).toEqual([]);
        p.changed.fire(null);
        await drain();
        expect(requests(stub, "treeView.refresh")).toEqual([{ viewId: "v" }]);
    });

    it("a burst becomes one request now and one after the window", async () => {
        const { members, stub, children } = setup();
        const p = provider(() => [node("a")]);
        members.createTreeView("v", { treeDataProvider: p });
        await children();
        for (let i = 0; i < 5; i++) p.changed.fire(undefined);
        await drain();
        expect(requests(stub, "treeView.refresh")).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(TREE_REFRESH_DELAY_MS - 1);
        expect(requests(stub, "treeView.refresh")).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1);
        await drain();
        expect(requests(stub, "treeView.refresh")).toHaveLength(2);
        // A quiet window sends nothing more.
        await vi.advanceTimersByTimeAsync(TREE_REFRESH_DELAY_MS * 3);
        expect(requests(stub, "treeView.refresh")).toHaveLength(2);
    });

    it("a single change in a quiet tree is one request, nothing trails it", async () => {
        const { members, stub, children } = setup();
        const p = provider(() => [node("a")]);
        members.createTreeView("v", { treeDataProvider: p });
        await children();
        p.changed.fire(undefined);
        await vi.advanceTimersByTimeAsync(TREE_REFRESH_DELAY_MS * 2);
        expect(requests(stub, "treeView.refresh")).toHaveLength(1);
    });

    it("the window is the option's when given", async () => {
        const stub = makeStubRpc();
        const members = createExtHostTreeViews(stub.rpc, {
            executeCommand: () => Promise.resolve(),
            refreshDelayMs: 10,
        });
        const p = provider(() => [node("a")]);
        members.createTreeView("v", { treeDataProvider: p });
        await stub.callRequest("treeView.getChildren", { viewId: "v" });
        p.changed.fire(undefined);
        p.changed.fire(undefined);
        await vi.advanceTimersByTimeAsync(10);
        await drain();
        expect(requests(stub, "treeView.refresh")).toHaveLength(2);
    });

    it("fire(el) sends the changed row and forgets its subtree; unknown and nested ones drop out", async () => {
        const { members, stub, children } = setup();
        const child = node("child", [node("grandchild")]);
        const parent = node("parent", [child]);
        const other = node("other");
        const p = provider(() => [parent, other]);
        members.createTreeView("v", { treeDataProvider: p });
        await children();
        await children("0/0:parent");
        await children("0/0:parent/0:child");
        parent.item.description = "changed";
        p.changed.fire([child, parent, node("stranger"), parent]);
        await drain();
        expect(requests(stub, "treeView.refresh")).toEqual([
            {
                viewId: "v",
                items: [{ handle: "0/0:parent", label: "parent", description: "changed", collapsibleState: 1 }],
            },
        ]);
        // The subtree is read again from the provider.
        child.children = [node("fresh")];
        expect(await children("0/0:parent")).toHaveLength(1);
        expect((await children("0/0:parent/0:child")).map((item) => item.label)).toEqual(["fresh"]);
    });

    it("fire(el) of a nested row alone refreshes just it", async () => {
        const { members, stub, children } = setup();
        const child = node("child");
        const parent = node("parent", [child]);
        const p = provider(() => [parent]);
        members.createTreeView("v", { treeDataProvider: p });
        await children();
        await children("0/0:parent");
        p.changed.fire(child);
        await drain();
        expect(requests(stub, "treeView.refresh")).toEqual([
            {
                viewId: "v",
                items: [
                    { handle: "0/0:parent/0:child", parentHandle: "0/0:parent", label: "child", collapsibleState: 0 },
                ],
            },
        ]);
    });

    it("an element that is not shown is not refreshed", async () => {
        const { members, stub } = setup();
        const p = provider(() => [node("a")]);
        members.createTreeView("v", { treeDataProvider: p });
        p.changed.fire(node("a"));
        await drain();
        expect(requests(stub, "treeView.refresh")).toEqual([]);
    });

    it("a rename moves the row to its new handle", async () => {
        const { members, stub, children, executed } = setup();
        const element = node("before");
        element.item.command = { command: "x.run", title: "Run" };
        const p = provider(() => [element]);
        members.createTreeView("v", { treeDataProvider: p });
        await children();
        element.item.label = "after";
        p.changed.fire(element);
        await drain();
        expect(requests(stub, "treeView.refresh")).toEqual([
            {
                viewId: "v",
                items: [
                    {
                        handle: "0/0:after",
                        label: "after",
                        collapsibleState: 0,
                        command: { id: "x.run", title: "Run" },
                    },
                ],
            },
        ]);
        await stub.callRequest("treeView.executeCommand", { viewId: "v", handle: "0/0:before" });
        await stub.callRequest("treeView.executeCommand", { viewId: "v", handle: "0/0:after" });
        expect(executed).toEqual([["x.run"]]);
    });

    it("a failed refresh is logged and doesn't block the next one", async () => {
        const { members, stub, children } = setup();
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        let fail = true;
        stub.responder = (method) => {
            if (method === "treeView.refresh" && fail) throw new Error("host gone");
            return null;
        };
        const p = provider(() => [node("a")]);
        members.createTreeView("v", { treeDataProvider: p });
        await children();
        p.changed.fire(undefined);
        await drain();
        expect(error).toHaveBeenCalledWith("[tree view v] Unable to refresh tree view: host gone");
        fail = false;
        await vi.advanceTimersByTimeAsync(TREE_REFRESH_DELAY_MS);
        p.changed.fire(undefined);
        await drain();
        expect(requests(stub, "treeView.refresh")).toHaveLength(2);
        error.mockRestore();
    });

    it("a non-Error failure is logged as text", async () => {
        const { members, stub, children } = setup();
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        stub.responder = (method) => {
            // eslint-disable-next-line @typescript-eslint/only-throw-error -- the wire may reject with anything
            if (method === "treeView.refresh") throw "closed";
            return null;
        };
        const p = provider(() => [node("a")]);
        members.createTreeView("v", { treeDataProvider: p });
        await children();
        p.changed.fire(undefined);
        await drain();
        expect(error).toHaveBeenCalledWith("[tree view v] Unable to refresh tree view: closed");
        error.mockRestore();
    });

    it("a fetch overtaken by a refresh doesn't register its stale rows", async () => {
        const { members, stub } = setup();
        let release: (nodes: INode[]) => void = () => undefined;
        let calls = 0;
        const p = provider(() => []);
        members.createTreeView("v", {
            treeDataProvider: {
                ...p,
                getChildren: () => {
                    calls++;
                    if (calls === 1) {
                        return new Promise<INode[]>((resolve) => {
                            release = resolve;
                        });
                    }
                    return [node("fresh")];
                },
            },
        });
        const stale = stub.callRequest("treeView.getChildren", { viewId: "v" }) as Promise<IWireTreeItem[]>;
        p.changed.fire(undefined);
        await drain();
        release([node("stale")]);
        expect(await stale).toEqual([]);
        const fresh = (await stub.callRequest("treeView.getChildren", { viewId: "v" })) as IWireTreeItem[];
        expect(fresh.map((item) => item.label)).toEqual(["fresh"]);
    });

    it("a view disposed while its provider answers registers nothing", async () => {
        const { members, stub } = setup();
        let release: (nodes: INode[]) => void = () => undefined;
        const view = members.createTreeView("v", {
            treeDataProvider: {
                getTreeItem: (e: INode) => e.item,
                getChildren: () =>
                    new Promise<INode[]>((resolve) => {
                        release = resolve;
                    }),
            },
        });
        const pending = stub.callRequest("treeView.getChildren", { viewId: "v" }) as Promise<IWireTreeItem[]>;
        view.dispose();
        release([node("late")]);
        expect(await pending).toEqual([]);
    });
});

describe("extHostTreeViews — reveal", () => {
    it("rejects without getParent, as upstream", async () => {
        const { members } = setup();
        const view = members.createTreeView("v", { treeDataProvider: provider(() => [node("a")]) });
        await expect(view.reveal(node("a"))).rejects.toThrow(
            "Required registered TreeDataProvider to implement 'getParent' method to access 'reveal' method",
        );
    });

    it("resolves the parent chain through getParent and sends rows the host can key", async () => {
        const { members, stub } = setup();
        const leaf = node("leaf");
        const mid = node("mid", [leaf]);
        const top = node("top", [mid]);
        const view = members.createTreeView("v", { treeDataProvider: provider(() => [top], true) });
        await view.reveal(leaf, { select: false, focus: true, expand: 2 });
        expect(requests(stub, "treeView.reveal")).toEqual([
            {
                viewId: "v",
                item: {
                    handle: "0/0:top/0:mid/0:leaf",
                    parentHandle: "0/0:top/0:mid",
                    label: "leaf",
                    collapsibleState: 0,
                },
                parentChain: [
                    { handle: "0/0:top", label: "top", collapsibleState: 1 },
                    { handle: "0/0:top/0:mid", parentHandle: "0/0:top", label: "mid", collapsibleState: 1 },
                ],
                select: false,
                focus: true,
                expand: 2,
            },
        ]);
    });

    it("defaults are select, no focus, no expand; a known element reuses its node", async () => {
        const { members, stub, children } = setup();
        const top = node("top");
        const view = members.createTreeView("v", { treeDataProvider: provider(() => [top], true) });
        await children();
        await view.reveal(top);
        expect(requests(stub, "treeView.reveal")).toEqual([
            {
                viewId: "v",
                item: { handle: "0/0:top", label: "top", collapsibleState: 0 },
                parentChain: [],
                select: true,
                focus: false,
                expand: false,
            },
        ]);
    });

    it("without an element only the view is revealed", async () => {
        const { members, stub } = setup();
        const view = members.createTreeView("v", { treeDataProvider: provider(() => [], true) });
        await view.reveal(undefined as unknown as INode, { focus: true });
        expect(requests(stub, "treeView.reveal")).toEqual([
            { viewId: "v", parentChain: [], select: true, focus: true, expand: false },
        ]);
    });

    it("an element the provider doesn't list is logged and resolves without a request", async () => {
        const { members, stub } = setup();
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const view = members.createTreeView("v", { treeDataProvider: provider(() => [node("a")], true) });
        await view.reveal(node("ghost"));
        expect(requests(stub, "treeView.reveal")).toEqual([]);
        expect(error).toHaveBeenCalledWith(
            "[tree view v] reveal failed: Cannot resolve tree item for element 0/0:ghost",
        );
        error.mockRestore();
    });

    it("a failing getParent is logged as text", async () => {
        const { members } = setup();
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const view = members.createTreeView("v", {
            treeDataProvider: {
                ...provider(() => []),
                getParent: () => {
                    // eslint-disable-next-line @typescript-eslint/only-throw-error -- an extension may throw anything
                    throw "parent lost";
                },
            },
        });
        await view.reveal(node("x"));
        expect(error).toHaveBeenCalledWith("[tree view v] reveal failed: parent lost");
        error.mockRestore();
    });
});
