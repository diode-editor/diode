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

describe("simulateWorkspaceFoldersUpdate — проверки эталона", () => {
    it("добавление в конец, замена и удаление дают новый набор", () => {
        expect(paths(simulateWorkspaceFoldersUpdate([{ uri: A }], 1, 0, [{ uri: B }]))).toEqual(["/ws/a", "/ws/b"]);
        expect(paths(simulateWorkspaceFoldersUpdate([{ uri: A }], 0, 1, [{ uri: B }]))).toEqual(["/ws/b"]);
        expect(paths(simulateWorkspaceFoldersUpdate([{ uri: A }, { uri: B }], 0, 1, []))).toEqual(["/ws/b"]);
        expect(paths(simulateWorkspaceFoldersUpdate([], 0, 0, [{ uri: C }]))).toEqual(["/ws/c"]);
    });

    it("повторы и не-Uri среди добавляемых отбрасываются", () => {
        const odd = [{ uri: B }, { uri: B }, { uri: "нет" }, null] as unknown as { uri: Uri }[];
        expect(paths(simulateWorkspaceFoldersUpdate([{ uri: A }], 1, 0, odd))).toEqual(["/ws/a", "/ws/b"]);
    });

    it("отрицательные и не числа — отказ", () => {
        expect(simulateWorkspaceFoldersUpdate([{ uri: A }], -1, 0, [{ uri: B }])).toBeNull();
        expect(simulateWorkspaceFoldersUpdate([{ uri: A }], 0, -1, [{ uri: B }])).toBeNull();
        expect(simulateWorkspaceFoldersUpdate([{ uri: A }], "0" as unknown as number, 0, [{ uri: B }])).toBeNull();
        expect(simulateWorkspaceFoldersUpdate([{ uri: A }], 0, "1" as unknown as number, [])).toBeNull();
    });

    it("нечего делать, удаление сверх имеющегося, дубль в итоге и итог без изменений — отказ", () => {
        expect(simulateWorkspaceFoldersUpdate([{ uri: A }], 0, 0, [])).toBeNull();
        expect(simulateWorkspaceFoldersUpdate([{ uri: A }], 1, 1, [])).toBeNull();
        expect(simulateWorkspaceFoldersUpdate([{ uri: A }], 0, 2, [])).toBeNull();
        expect(simulateWorkspaceFoldersUpdate([{ uri: A }], 1, 0, [{ uri: A }])).toBeNull();
        expect(simulateWorkspaceFoldersUpdate([{ uri: A }], 0, 1, [{ uri: A }])).toBeNull();
    });

    it("удаление ровно до конца — допустимо", () => {
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
    it("итог в одну папку — true и просьба хосту от имени расширения", () => {
        const { workspace, owner, sent } = makeWorkspace(["/ws/a"]);
        const ok = owner.runAs("golang.go", () => workspace.updateWorkspaceFolders(0, 1, { uri: B }));
        expect(ok).toBe(true);
        expect(sent()).toEqual([{ extensionId: "golang.go", folders: ["/ws/b"] }]);
    });

    it("вторая папка — false, а хосту уходит просьба (он скажет человеку, почему нет)", () => {
        const { workspace, owner, sent } = makeWorkspace(["/ws/a"]);
        // Так зовёт golang.go («Go: Add Package to Workspace»): deleteCount = null.
        const ok = owner.runAs("golang.go", () => workspace.updateWorkspaceFolders(1, null, { uri: B }));
        expect(ok).toBe(false);
        expect(sent()).toEqual([{ extensionId: "golang.go", folders: ["/ws/a", "/ws/b"] }]);
    });

    it("пустое окно: добавление папки — true; удаление единственной — false", () => {
        const empty = makeWorkspace([]);
        expect(empty.workspace.updateWorkspaceFolders(0, undefined, { uri: A })).toBe(true);
        expect(empty.sent()).toEqual([{ extensionId: null, folders: ["/ws/a"] }]);

        const single = makeWorkspace(["/ws/a"]);
        expect(single.workspace.updateWorkspaceFolders(0, 1)).toBe(false);
        expect(single.sent()).toEqual([{ extensionId: null, folders: [] }]);
    });

    it("недопустимые аргументы — false без просьбы хосту", () => {
        const { workspace, sent } = makeWorkspace(["/ws/a"]);
        expect(workspace.updateWorkspaceFolders(0, 0)).toBe(false);
        expect(workspace.updateWorkspaceFolders(5, 0, { uri: B })).toBe(false);
        expect(sent()).toEqual([]);
    });
});
