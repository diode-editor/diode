import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { Uri } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";
import { createWorkspaceNamespace } from "./workspaceNamespace.ts";

/** Members missing from the active part of vscode.d.ts: the runtime is ahead of the declaration. */
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

describe("WorkspaceNamespace — naive LSP surface", () => {
    it("never-firing events subscribe and unsubscribe without errors", () => {
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

    it("registerTextDocumentContentProvider returns a valid Disposable", () => {
        const { naive } = makeWorkspace();
        const disposable = naive.registerTextDocumentContentProvider("scheme", {});
        expect(() => {
            disposable.dispose();
        }).not.toThrow();
    });

    describe("getWorkspaceFolder", () => {
        /** Two folders: a single-folder set cannot verify matching — "the first" and "the right one" coincide. */
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

        it("file inside a folder gives that folder, not the first one listed", () => {
            expect(folderLookup()("/proj/b/src/x.ts")).toBe("b");
        });

        it("a folder counts as lying inside itself", () => {
            expect(folderLookup()("/proj/a")).toBe("a");
        });

        // Upstream: "Returns `undefined` when the given uri doesn't match any workspace
        // folder". Falling back to the first folder in a multi-root would address a foreign project.
        it("file outside all folders gives undefined, NOT the first folder", () => {
            expect(folderLookup()("/elsewhere/x.ts")).toBeUndefined();
        });

        it("a sibling sharing a name prefix does not count as the folder", () => {
            expect(folderLookup()("/proj/abc/x.ts")).toBeUndefined();
        });

        it("empty window gives undefined for any file", () => {
            const { naive } = makeWorkspace();
            expect(naive.getWorkspaceFolder(Uri.file("/proj/a/x.ts"))).toBeUndefined();
        });
    });

    it("createFileSystemWatcher without a workspace returns a valid silent watcher", () => {
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
