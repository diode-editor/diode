import { describe, expect, it } from "vitest";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { Uri } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";
import { simulateWorkspaceFoldersUpdate } from "./workspaceFoldersUpdate.ts";
import { createWorkspaceNamespace } from "./workspaceNamespace.ts";

const A = Uri.file("/ws/a");
const B = Uri.file("/ws/b");
const C = Uri.file("/ws/c");

function paths(result: Uri[] | null): string[] | null {
    return result === null ? null : result.map((uri) => uri.fsPath);
}

describe("simulateWorkspaceFoldersUpdate: upstream checks", () => {
    it("append, replace and delete yield a new set", () => {
        expect(paths(simulateWorkspaceFoldersUpdate([{ uri: A }], 1, 0, [{ uri: B }]))).toEqual(["/ws/a", "/ws/b"]);
        expect(paths(simulateWorkspaceFoldersUpdate([{ uri: A }], 0, 1, [{ uri: B }]))).toEqual(["/ws/b"]);
        expect(paths(simulateWorkspaceFoldersUpdate([{ uri: A }, { uri: B }], 0, 1, []))).toEqual(["/ws/b"]);
        expect(paths(simulateWorkspaceFoldersUpdate([], 0, 0, [{ uri: C }]))).toEqual(["/ws/c"]);
    });

    it("distinct folders are all added; replacing the second of two is a change", () => {
        expect(paths(simulateWorkspaceFoldersUpdate([{ uri: A }], 1, 0, [{ uri: B }, { uri: C }]))).toEqual([
            "/ws/a",
            "/ws/b",
            "/ws/c",
        ]);
        expect(paths(simulateWorkspaceFoldersUpdate([{ uri: A }, { uri: B }], 1, 1, [{ uri: C }]))).toEqual([
            "/ws/a",
            "/ws/c",
        ]);
    });

    it("duplicates and non-Uris among the added are dropped", () => {
        const odd = [{ uri: B }, { uri: B }, { uri: "nope" }, null] as unknown as { uri: Uri }[];
        expect(paths(simulateWorkspaceFoldersUpdate([{ uri: A }], 1, 0, odd))).toEqual(["/ws/a", "/ws/b"]);
    });

    it("negatives and non-numbers are rejected", () => {
        expect(simulateWorkspaceFoldersUpdate([{ uri: A }], -1, 0, [{ uri: B }])).toBeNull();
        expect(simulateWorkspaceFoldersUpdate([{ uri: A }], 0, -1, [{ uri: B }])).toBeNull();
        expect(simulateWorkspaceFoldersUpdate([{ uri: A }], "0" as unknown as number, 0, [{ uri: B }])).toBeNull();
        expect(simulateWorkspaceFoldersUpdate([{ uri: A }], 0, "1" as unknown as number, [])).toBeNull();
    });

    it("nothing to do, deleting beyond what exists, a duplicate in the result and an unchanged result are rejected", () => {
        expect(simulateWorkspaceFoldersUpdate([{ uri: A }], 0, 0, [])).toBeNull();
        expect(simulateWorkspaceFoldersUpdate([{ uri: A }], 1, 1, [])).toBeNull();
        expect(simulateWorkspaceFoldersUpdate([{ uri: A }], 0, 2, [])).toBeNull();
        expect(simulateWorkspaceFoldersUpdate([{ uri: A }], 1, 0, [{ uri: A }])).toBeNull();
        expect(simulateWorkspaceFoldersUpdate([{ uri: A }], 0, 1, [{ uri: A }])).toBeNull();
    });

    it("deleting exactly to the end is allowed", () => {
        expect(paths(simulateWorkspaceFoldersUpdate([{ uri: A }, { uri: B }], 1, 1, []))).toEqual(["/ws/a"]);
    });
});

function makeWorkspace(folders: readonly string[]) {
    const stub = makeStubRpc();
    const registry = new DocumentRegistry();
    const owner = new ExtensionOwner();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry),
        configStore: new WorkspaceConfigStore(),
        disk: createNodeExtHostDisk(),
        owner,
    };
    const workspace = createWorkspaceNamespace(ctx);
    stub.fire("workspace.initialize", {
        workspaceFolders: folders.map((folder, index) => ({
            uri: Uri.file(folder).toString(),
            name: folder,
            index,
        })),
    });
    const sent = (): unknown[] =>
        stub.notifies.filter((n) => n.method === "workspace.updateWorkspaceFolders").map((n) => n.params);
    return { workspace, owner, sent };
}

describe("workspace.updateWorkspaceFolders", () => {
    it("a single-folder result: true and a request to the host on behalf of the extension", () => {
        const { workspace, owner, sent } = makeWorkspace(["/ws/a"]);
        const ok = owner.runAs("golang.go", () => workspace.updateWorkspaceFolders(0, 1, { uri: B }));
        expect(ok).toBe(true);
        expect(sent()).toEqual([{ extensionId: "golang.go", folders: ["/ws/b"] }]);
    });

    it("a second folder: false, but the request goes to the host (it tells the user why not)", () => {
        const { workspace, owner, sent } = makeWorkspace(["/ws/a"]);
        // This is how golang.go calls it ("Go: Add Package to Workspace"): deleteCount = null.
        const ok = owner.runAs("golang.go", () => workspace.updateWorkspaceFolders(1, null, { uri: B }));
        expect(ok).toBe(false);
        expect(sent()).toEqual([{ extensionId: "golang.go", folders: ["/ws/a", "/ws/b"] }]);
    });

    it("empty window: adding a folder is true; removing the only one is false", () => {
        const empty = makeWorkspace([]);
        expect(empty.workspace.updateWorkspaceFolders(0, undefined, { uri: A })).toBe(true);
        expect(empty.sent()).toEqual([{ extensionId: null, folders: ["/ws/a"] }]);

        const single = makeWorkspace(["/ws/a"]);
        expect(single.workspace.updateWorkspaceFolders(0, 1)).toBe(false);
        expect(single.sent()).toEqual([{ extensionId: null, folders: [] }]);
    });

    it("invalid arguments: false without a request to the host", () => {
        const { workspace, sent } = makeWorkspace(["/ws/a"]);
        expect(workspace.updateWorkspaceFolders(0, 0)).toBe(false);
        expect(workspace.updateWorkspaceFolders(5, 0, { uri: B })).toBe(false);
        expect(sent()).toEqual([]);
    });
});
