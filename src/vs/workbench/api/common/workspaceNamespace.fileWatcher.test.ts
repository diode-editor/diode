import type * as vscode from "vscode";

import { describe, expect, it } from "vitest";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
import { RelativePattern, Uri } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";
import { createWorkspaceNamespace } from "./workspaceNamespace.ts";

/**
 * Проводка `workspace.createFileSystemWatcher` в субпроцессе: запрос на хост,
 * разводка присланных событий, снятие. Сам реестр тестируется без RPC в
 * `fileWatcherNamespace.test.ts` — здесь именно шов с каналом.
 */
function makeWorkspace(root: string | null = "/repo") {
    const stub = makeStubRpc();
    const registry = new DocumentRegistry();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry),
        configStore: new WorkspaceConfigStore(),
    };
    const workspace = createWorkspaceNamespace(ctx);
    if (root !== null) {
        stub.fire("workspace.initialize", {
            configuration: {},
            workspaceFolders: [{ uri: Uri.file(root).toString(), name: "repo", index: 0 }],
        });
    }
    return { stub, workspace };
}

describe("workspace.createFileSystemWatcher — проводка RPC", () => {
    it("строковый шаблон уезжает на хост с базой из папки воркспейса", () => {
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

    it("события хоста доходят до слушателей расширения", () => {
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

    it("мусорная пачка от хоста игнорируется", () => {
        const { stub, workspace } = makeWorkspace();
        const watcher = workspace.createFileSystemWatcher("**");
        const seen: string[] = [];
        watcher.onDidChange((uri) => seen.push(uri.fsPath));

        expect(() => stub.fire("workspace.watcher.events", "не объект")).not.toThrow();
        expect(seen).toEqual([]);
    });

    it("dispose снимает watcher на хосте", () => {
        const { stub, workspace } = makeWorkspace();

        workspace.createFileSystemWatcher("**").dispose();

        expect(stub.notifies.at(-1)).toEqual({ method: "workspace.watcher.dispose", params: { id: 1 } });
    });

    it("в пустом окне строковый шаблон резолвить не к чему — хост не тревожим", () => {
        const { stub, workspace } = makeWorkspace(null);

        const watcher = workspace.createFileSystemWatcher("**");

        expect(stub.notifies.filter((n) => n.method === "workspace.watcher.create")).toEqual([]);
        expect(() => watcher.dispose()).not.toThrow();
    });
});
