import type * as vscode from "vscode";

import { describe, expect, it } from "vitest";

import { DocumentRegistry } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
import { Uri } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";
import { createWorkspaceNamespace } from "./workspaceNamespace.ts";

// Наивная поверхность workspace, которую трогает vscode-languageclient:
// валидные никогда-не-стреляющие события + простейшие методы. Статусы и шаги
// закрытия — таблица стабов в docs/TODO/LSP.md.

function makeWorkspace() {
    const stub = makeStubRpc();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry: new DocumentRegistry(),
        configStore: new WorkspaceConfigStore(),
    };
    return { stub, workspace: createWorkspaceNamespace(ctx) };
}

describe("WorkspaceNamespace — наивная поверхность LSP", () => {
    it("никогда-не-стреляющие события подписываются и отписываются без ошибок", () => {
        const { workspace } = makeWorkspace();
        const ws = workspace as unknown as Record<string, (l: () => void) => { dispose(): void }>;
        for (const name of [
            "onDidChangeWorkspaceFolders",
            "onDidCreateFiles",
            "onDidDeleteFiles",
            "onDidRenameFiles",
            "onWillCreateFiles",
            "onWillDeleteFiles",
            "onWillRenameFiles",
            "onDidOpenNotebookDocument",
            "onDidCloseNotebookDocument",
            "onDidChangeNotebookDocument",
            "onDidSaveNotebookDocument",
        ]) {
            const disposable = ws[name](() => undefined);
            expect(disposable, name).toBeDefined();
            expect(() => disposable.dispose(), name).not.toThrow();
        }
        expect(workspace.notebookDocuments).toEqual([]);
    });

    it("applyEdit наивно подтверждает; registerTextDocumentContentProvider — валидный Disposable", async () => {
        const { workspace } = makeWorkspace();
        await expect(workspace.applyEdit({} as never)).resolves.toBe(true);
        const disposable = workspace.registerTextDocumentContentProvider("scheme", {} as never);
        expect(() => disposable.dispose()).not.toThrow();
    });

    it("getWorkspaceFolder матчит по префиксу пути, иначе первая папка", () => {
        const { stub, workspace } = makeWorkspace();
        stub.fire("workspace.initialize", {
            configuration: {},
            workspaceFolders: [
                { uri: Uri.file("/proj/a").toString(), name: "a", index: 0 },
                { uri: Uri.file("/proj/b").toString(), name: "b", index: 1 },
            ],
        });
        const folderOf = (p: string) =>
            (workspace.getWorkspaceFolder(Uri.file(p) as unknown as vscode.Uri) as unknown as { name: string } | undefined)
                ?.name;
        expect(folderOf("/proj/b/src/x.ts")).toBe("b");
        expect(folderOf("/proj/a")).toBe("a");
        // Вне всех папок — наивный fallback на первую (клиенту нужен хоть какой-то корень).
        expect(folderOf("/elsewhere/x.ts")).toBe("a");
    });

    it("createFileSystemWatcher — валидный не-стреляющий watcher", () => {
        const { workspace } = makeWorkspace();
        const watcher = workspace.createFileSystemWatcher("**/*.ts");
        const sub = watcher.onDidChange(() => undefined);
        expect(watcher.ignoreCreateEvents).toBe(false);
        expect(watcher.ignoreChangeEvents).toBe(false);
        expect(watcher.ignoreDeleteEvents).toBe(false);
        expect(() => watcher.onDidCreate(() => undefined).dispose()).not.toThrow();
        expect(() => watcher.onDidDelete(() => undefined).dispose()).not.toThrow();
        sub.dispose();
        expect(() => watcher.dispose()).not.toThrow();
    });
});
