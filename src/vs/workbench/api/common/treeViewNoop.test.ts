import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { makeStubRpc } from "./testStubRpc.ts";
import { createTreeViewNoopMembers } from "./treeViewNoop.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";

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

/** A provider that fails loudly if called: there is no tree, so nobody should call it. */
function silentProvider(): vscode.TreeDataProvider<string> {
    return {
        getTreeItem: (): never => {
            throw new Error("getTreeItem must not be called");
        },
        getChildren: (): never => {
            throw new Error("getChildren must not be called");
        },
    };
}

describe("treeViewNoop — extension tree views as a stub", () => {
    it("registerTreeDataProvider writes one warn line to Output, the key point first", () => {
        const { members, stub } = makeMembers();

        members.registerTreeDataProvider("bazelTaskOutline", silentProvider());

        const lines = outputLines(stub);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toEqual({
            channel: "extensions",
            label: "Extensions",
            level: "warn",
            value: 'tree view "bazelTaskOutline" is not rendered in TUI yet — no panel, the rest of the extension works',
        });
    });

    it("the same viewId again adds no second line; another view gets its own line", () => {
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

    it("registerTreeDataProvider returns a Disposable that can be disposed twice", () => {
        const { members } = makeMembers();

        const disposable = members.registerTreeDataProvider("a.view", silentProvider());

        expect(() => {
            disposable.dispose();
            disposable.dispose();
        }).not.toThrow();
    });

    it("createTreeView returns an inert TreeView", async () => {
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

        view.title = "Bazel Run Targets";
        view.message = "loading…";
        view.description = "3 targets";
        view.badge = { tooltip: "targets", value: 3 };
        expect(view.title).toBe("Bazel Run Targets");
        expect(view.message).toBe("loading…");
        expect(view.description).toBe("3 targets");
        expect(view.badge).toEqual({ tooltip: "targets", value: 3 });

        await expect(view.reveal("x", { select: true })).resolves.toBeUndefined();
        view.dispose();
        view.dispose();

        expect(fired).toBe(0);
        expect(stub.notifies).toHaveLength(1);
        expect(stub.requests).toHaveLength(0);
    });

    it("createTreeView without treeDataProvider throws like upstream and writes nothing to Output", () => {
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

    it("the members are available on vscode.window", () => {
        const stub = makeStubRpc();
        const { namespace } = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk());

        const disposable = namespace.window.registerTreeDataProvider("w.view", silentProvider());
        const view = namespace.window.createTreeView("w.view2", { treeDataProvider: silentProvider() });

        expect(typeof disposable.dispose).toBe("function");
        expect(view.visible).toBe(false);
        expect(outputLines(stub)).toHaveLength(2);
    });
});
