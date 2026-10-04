import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { Uri } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";
import { createWorkspaceNamespace } from "./workspaceNamespace.ts";

// Наивная поверхность workspace, которую трогает vscode-languageclient:
// валидные никогда-не-стреляющие события + простейшие методы. Статусы и шаги
// закрытия — таблица стабов в docs/TODO/LSP.md.

/** Наивная поверхность workspace, отсутствующая в активной части vscode.d.ts (runtime опережает декларацию). */
interface INaiveWorkspaceSurface {
    notebookDocuments: readonly unknown[];
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
        disk: createNodeExtHostDisk(),
        owner: new ExtensionOwner(),
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
            expect(() => {
                disposable.dispose();
            }, name).not.toThrow();
        }
        expect(makeWorkspace().naive.notebookDocuments).toEqual([]);
    });

    it("registerTextDocumentContentProvider — валидный Disposable", () => {
        const { naive } = makeWorkspace();
        const disposable = naive.registerTextDocumentContentProvider("scheme", {});
        expect(() => {
            disposable.dispose();
        }).not.toThrow();
    });

    describe("getWorkspaceFolder", () => {
        /** Две папки: однопапочным набором матч не проверишь — «первая» и «та самая» совпадут. */
        function folderLookup(): (p: string) => string | undefined {
            const { stub, naive } = makeWorkspace();
            stub.fire("workspace.initialize", {
                configuration: { defaults: {}, user: {} },
                workspaceFolders: [
                    { uri: Uri.file("/proj/a").toString(), name: "a", index: 0 },
                    { uri: Uri.file("/proj/b").toString(), name: "b", index: 1 },
                ],
            });
            return (p: string) => naive.getWorkspaceFolder(Uri.file(p))?.name;
        }

        it("файл внутри папки — эта папка, а не первая по списку", () => {
            expect(folderLookup()("/proj/b/src/x.ts")).toBe("b");
        });

        it("сама папка считается лежащей внутри себя", () => {
            expect(folderLookup()("/proj/a")).toBe("a");
        });

        // Главный инвариант: файл ВНЕ папок воркспейса — `undefined`, как в
        // эталоне («Returns `undefined` when the given uri doesn't match any
        // workspace folder»). Раньше здесь стоял fallback на первую папку: в
        // однопапочном мире почти безобидный, в мульти-руте — неверная адресация
        // (расширение писало бы настройки и искало файлы в чужом проекте).
        it("файл вне всех папок — undefined, а НЕ первая папка", () => {
            expect(folderLookup()("/elsewhere/x.ts")).toBeUndefined();
        });

        // Префикс-матч идёт по границе сегмента: `/proj/abc` не внутри `/proj/a`.
        it("сосед с общим префиксом имени папкой не считается", () => {
            expect(folderLookup()("/proj/abc/x.ts")).toBeUndefined();
        });

        it("пустое окно — undefined на любой файл", () => {
            const { naive } = makeWorkspace();
            expect(naive.getWorkspaceFolder(Uri.file("/proj/a/x.ts"))).toBeUndefined();
        });
    });

    it("createFileSystemWatcher без воркспейса — валидный немой watcher", () => {
        // Настоящее поведение watcher'ов — в workspaceNamespace.fileWatcher.test.ts;
        // здесь только то, что важно клиенту LSP: в пустом окне ничего не падает.
        const { naive } = makeWorkspace();
        const watcher = naive.createFileSystemWatcher("**/*.ts");
        const sub = watcher.onDidChange(() => undefined);
        expect(watcher.ignoreCreateEvents).toBe(false);
        expect(() => {
            watcher.onDidCreate(() => undefined).dispose();
        }).not.toThrow();
        expect(() => {
            watcher.onDidDelete(() => undefined).dispose();
        }).not.toThrow();
        sub.dispose();
        expect(() => {
            watcher.dispose();
        }).not.toThrow();
    });
});
