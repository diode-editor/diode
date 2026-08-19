import type * as vscode from "vscode";

import { describe, expect, it } from "vitest";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
import { Uri } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";
import { createWorkspaceNamespace } from "./workspaceNamespace.ts";

// Наивная поверхность workspace, которую трогает vscode-languageclient:
// валидные никогда-не-стреляющие события + простейшие методы. Статусы и шаги
// закрытия — таблица стабов в docs/TODO/LSP.md.

/** Наивная поверхность workspace, отсутствующая в активной части vscode.d.ts (runtime опережает декларацию). */
interface INaiveWorkspaceSurface {
    notebookDocuments: readonly unknown[];
    applyEdit(edit: unknown): Thenable<boolean>;
    registerTextDocumentContentProvider(scheme: string, provider: unknown): { dispose(): void };
    getWorkspaceFolder(uri: unknown): { name: string } | undefined;
    createFileSystemWatcher(glob: string): {
        onDidCreate(l: () => void): { dispose(): void };
        onDidChange(l: () => void): { dispose(): void };
        onDidDelete(l: () => void): { dispose(): void };
        ignoreCreateEvents: boolean;
        ignoreChangeEvents: boolean;
        ignoreDeleteEvents: boolean;
        dispose(): void;
    };
}

function makeWorkspace() {
    const stub = makeStubRpc();
    const registry = new DocumentRegistry();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry),
        configStore: new WorkspaceConfigStore(),
    };
    const workspace = createWorkspaceNamespace(ctx);
    return { stub, workspace, naive: workspace as unknown as INaiveWorkspaceSurface };
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
        expect(makeWorkspace().naive.notebookDocuments).toEqual([]);
    });

    it("applyEdit наивно подтверждает; registerTextDocumentContentProvider — валидный Disposable", async () => {
        const { naive } = makeWorkspace();
        await expect(naive.applyEdit({})).resolves.toBe(true);
        const disposable = naive.registerTextDocumentContentProvider("scheme", {});
        expect(() => disposable.dispose()).not.toThrow();
    });

    it("getWorkspaceFolder матчит по префиксу пути, иначе первая папка", () => {
        const { stub, naive } = makeWorkspace();
        stub.fire("workspace.initialize", {
            configuration: {},
            workspaceFolders: [
                { uri: Uri.file("/proj/a").toString(), name: "a", index: 0 },
                { uri: Uri.file("/proj/b").toString(), name: "b", index: 1 },
            ],
        });
        const folderOf = (p: string): string | undefined => naive.getWorkspaceFolder(Uri.file(p))?.name;
        expect(folderOf("/proj/b/src/x.ts")).toBe("b");
        expect(folderOf("/proj/a")).toBe("a");
        // Вне всех папок — наивный fallback на первую (клиенту нужен хоть какой-то корень).
        expect(folderOf("/elsewhere/x.ts")).toBe("a");
    });

    it("createFileSystemWatcher без воркспейса — валидный немой watcher", () => {
        // Настоящее поведение watcher'ов — в workspaceNamespace.fileWatcher.test.ts;
        // здесь только то, что важно клиенту LSP: в пустом окне ничего не падает.
        const { naive } = makeWorkspace();
        const watcher = naive.createFileSystemWatcher("**/*.ts");
        const sub = watcher.onDidChange(() => undefined);
        expect(watcher.ignoreCreateEvents).toBe(false);
        expect(() => watcher.onDidCreate(() => undefined).dispose()).not.toThrow();
        expect(() => watcher.onDidDelete(() => undefined).dispose()).not.toThrow();
        sub.dispose();
        expect(() => watcher.dispose()).not.toThrow();
    });
});
