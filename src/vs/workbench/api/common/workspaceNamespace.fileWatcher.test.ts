import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { RelativePattern, Uri } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";
import { createWorkspaceNamespace } from "./workspaceNamespace.ts";

function makeWorkspace(root: string | null = "/repo") {
    const stub = makeStubRpc();
    const registry = new DocumentRegistry();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry),
        configStore: new WorkspaceConfigStore(),
        disk: createNodeExtHostDisk(),
        owner: new ExtensionOwner(),
    };
    const workspace = createWorkspaceNamespace(ctx);
    if (root !== null) {
        stub.fire("workspace.initialize", {
            configuration: { defaults: {}, user: {} },
            workspaceFolders: [{ uri: Uri.file(root).toString(), name: "repo", index: 0 }],
        });
    }
    return { stub, workspace };
}

describe("workspace.createFileSystemWatcher — RPC wiring", () => {
    it("a string pattern goes to the host with the workspace folder as base", () => {
        const { stub, workspace } = makeWorkspace();

        workspace.createFileSystemWatcher("**/*.ts");

        expect(stub.notifies.filter((n) => n.method === "workspace.watcher.create")).toEqual([
            {
                method: "workspace.watcher.create",
                params: {
                    id: 1,
                    base: "/repo",
                    pattern: "**/*.ts",
                    ignoreCreateEvents: false,
                    ignoreChangeEvents: false,
                    ignoreDeleteEvents: false,
                },
            },
        ]);
    });

    it("host events reach the extension listeners", () => {
        const { stub, workspace } = makeWorkspace();
        const watcher = workspace.createFileSystemWatcher(
            new RelativePattern("/repo/.git", "*") as unknown as vscode.GlobPattern,
        );
        const seen: string[] = [];
        watcher.onDidChange((uri) => seen.push(uri.fsPath));

        stub.fire("workspace.watcher.events", {
            id: 1,
            events: [{ type: "changed", uri: Uri.file("/repo/.git/HEAD").toString() }],
        });

        expect(seen).toEqual(["/repo/.git/HEAD"]);
    });

    it("a garbage batch from the host is ignored", () => {
        const { stub, workspace } = makeWorkspace();
        const watcher = workspace.createFileSystemWatcher("**");
        const seen: string[] = [];
        watcher.onDidChange((uri) => seen.push(uri.fsPath));

        expect(() => {
            stub.fire("workspace.watcher.events", "not an object");
        }).not.toThrow();
        expect(seen).toEqual([]);
    });

    it("dispose removes the watcher on the host", () => {
        const { stub, workspace } = makeWorkspace();

        workspace.createFileSystemWatcher("**").dispose();

        expect(stub.notifies.at(-1)).toEqual({ method: "workspace.watcher.dispose", params: { id: 1 } });
    });

    it("in an empty window a string pattern has nothing to resolve against, the host is not bothered", () => {
        const { stub, workspace } = makeWorkspace(null);

        const watcher = workspace.createFileSystemWatcher("**");

        expect(stub.notifies.filter((n) => n.method === "workspace.watcher.create")).toEqual([]);
        expect(() => {
            watcher.dispose();
        }).not.toThrow();
    });
});
