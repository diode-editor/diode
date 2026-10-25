import { describe, expect, it } from "vitest";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner } from "./vscodeHostContext.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";
import { TreeItem } from "./vscodeTypes.ts";
import { createWindowNamespace } from "./windowNamespace.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

function runnableTree(command: { command: string; arguments?: unknown[] }) {
    const row = new TreeItem("row");
    row.command = { title: "Run", ...command };
    return { getTreeItem: (element: TreeItem) => element, getChildren: () => [row] };
}

// A row's command goes through `vscode.commands`: the extension's own command gets its own objects.
describe("tree views in the vscode namespace", () => {
    it("a row's command reaches a command the extension registered, and the owner is named", async () => {
        const stub = makeStubRpc();
        const host = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk());
        const target = { kind: "target" };
        const seen: unknown[] = [];
        host.namespace.commands.registerCommand("ext.run", (arg: unknown) => seen.push(arg));
        host.owner.runAs("pub.ext", () =>
            host.namespace.window.registerTreeDataProvider(
                "v",
                runnableTree({ command: "ext.run", arguments: [target] }),
            ),
        );
        await stub.callRequest("treeView.getChildren", { viewId: "v" });
        await stub.callRequest("treeView.executeCommand", { viewId: "v", handle: "0/0:row" });
        expect(seen).toEqual([target]);
        expect(seen[0]).toBe(target);
        expect(stub.notifies.find((n) => n.method === "treeView.register")?.params).toEqual({
            viewId: "v",
            showCollapseAll: false,
            canSelectMany: false,
            extensionId: "pub.ext",
        });
    });

    it("`window` alone sends a row's command to the host and names the owner", async () => {
        const stub = makeStubRpc();
        const registry = new DocumentRegistry();
        const owner = new ExtensionOwner();
        const window = createWindowNamespace({
            rpc: stub.rpc,
            registry,
            documentSync: new DocumentSyncTracker(registry),
            configStore: new WorkspaceConfigStore(),
            disk: createNodeExtHostDisk(),
            owner,
        });
        owner.runAs("pub.ext", () =>
            window.createTreeView("v", { treeDataProvider: runnableTree({ command: "host.cmd", arguments: [1] }) }),
        );
        await stub.callRequest("treeView.getChildren", { viewId: "v" });
        await stub.callRequest("treeView.executeCommand", { viewId: "v", handle: "0/0:row" });
        expect(stub.requests).toEqual([{ method: "commands.executeCommand", params: { id: "host.cmd", args: [1] } }]);
        expect(stub.notifies.find((n) => n.method === "treeView.register")?.params).toMatchObject({
            extensionId: "pub.ext",
        });
    });
});
