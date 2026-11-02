import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { Range, Uri } from "./vscodeTypes.ts";
import { createWindowNamespace, openBeforeShow } from "./windowNamespace.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

/** The stub RPC answers undefined, but this needs a real `editor.showTextDocument` reply. */
function makeCtx(requestResult?: unknown) {
    const stub = makeStubRpc();
    if (requestResult !== undefined) {
        (stub.rpc as unknown as { request(method: string, params: unknown): Promise<unknown> }).request = (
            method,
            params,
        ) => {
            stub.requests.push({ method, params });
            return Promise.resolve(requestResult);
        };
    }
    const registry = new DocumentRegistry();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry),
        configStore: new WorkspaceConfigStore(),
        disk: createNodeExtHostDisk(),
        owner: new ExtensionOwner(),
    };
    return { stub, registry, window: createWindowNamespace(ctx) };
}

const A = Uri.file("/p/a.ts");
const B = Uri.file("/p/b.ts");

describe("WindowNamespace — showTextDocument goes through openTextDocument for a disk uri", () => {
    function makeOpening(open: (uri: vscode.Uri) => Thenable<vscode.TextDocument>) {
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
        const window = createWindowNamespace(ctx);
        window.showTextDocument = openBeforeShow(window.showTextDocument, open);
        return { stub, registry, window };
    }

    it("[api:window.showTextDocument] a missing file rejects and asks the host to show nothing", async () => {
        const { stub, window } = makeOpening(() => Promise.reject(new Error("ENOENT")));

        await expect(window.showTextDocument(A)).rejects.toThrow("ENOENT");

        expect(stub.requests).toEqual([]);
    });

    it("a disk uri opens first and then shows, with its arguments", async () => {
        const opened: string[] = [];
        const { stub, window } = makeOpening((uri) => {
            opened.push(uri.toString());
            return Promise.resolve({} as vscode.TextDocument);
        });

        await window.showTextDocument(A, { viewColumn: 2 });

        expect(opened).toEqual([A.toString()]);
        expect(stub.requests.at(-1)).toEqual({
            method: "editor.showTextDocument",
            params: { uri: A.toString(), viewColumn: 2 },
        });
    });

    it("a document object and a non-disk uri are not opened again", async () => {
        const opened: string[] = [];
        const { stub, registry, window } = makeOpening((uri) => {
            opened.push(uri.toString());
            return Promise.reject(new Error("unexpected"));
        });

        await window.showTextDocument(registry.getOrCreate(A) as unknown as vscode.TextDocument);
        await window.showTextDocument(Uri.parse("untitled:Untitled-1"));

        expect(opened).toEqual([]);
        expect(stub.requests.length).toBe(2);
    });
});

describe("WindowNamespace — selection of another group's editor", () => {
    it("[api:window.onDidChangeTextEditorSelection] does not overwrite the active editor's selection", () => {
        const { stub, window } = makeCtx();
        const tab = { uri: A.toString(), label: "a.ts", isActive: true, isDirty: false, kind: "text" };
        stub.fire("editor.layoutChanged", {
            groups: [
                { groupId: 1, viewColumn: 1, isActive: true, tabs: [tab] },
                { groupId: 2, viewColumn: 2, isActive: false, tabs: [tab] },
            ],
        });
        stub.fire("editor.activeEditorChanged", { uri: A.toString(), groupId: 1 });
        const at = (line: number) => ({ anchorLine: line, anchorCharacter: 0, activeLine: line, activeCharacter: 0 });
        stub.fire("editor.selectionChanged", { uri: A.toString(), groupId: 1, selections: [at(1)] });

        stub.fire("editor.selectionChanged", { uri: A.toString(), groupId: 2, selections: [at(5)] });

        expect(window.activeTextEditor?.selection.active.line).toBe(1);
    });
});

describe("WindowNamespace — showTextDocument (overload normalization)", () => {
    it("document + column number + preserveFocus → request with viewColumn/preserveFocus", async () => {
        const { stub, registry, window } = makeCtx();
        const doc = registry.getOrCreate(A) as unknown as vscode.TextDocument;

        await window.showTextDocument(doc, 2, true);

        expect(stub.requests.at(-1)).toEqual({
            method: "editor.showTextDocument",
            params: { uri: A.toString(), viewColumn: 2, preserveFocus: true },
        });
    });

    it("uri + options with selection → request with a wire selection", async () => {
        const { stub, window } = makeCtx();

        await window.showTextDocument(A, {
            viewColumn: -2,
            preserveFocus: false,
            selection: new Range(1, 2, 3, 4) as unknown as vscode.Range,
        });

        expect(stub.requests.at(-1)).toEqual({
            method: "editor.showTextDocument",
            params: {
                uri: A.toString(),
                viewColumn: -2,
                preserveFocus: false,
                selection: { anchorLine: 1, anchorCharacter: 2, activeLine: 3, activeCharacter: 4 },
            },
        });
    });

    it("uri without options → request with just the uri", async () => {
        const { stub, window } = makeCtx();

        await window.showTextDocument(A);

        expect(stub.requests.at(-1)).toEqual({
            method: "editor.showTextDocument",
            params: { uri: A.toString() },
        });
    });

    it("host answer (uri, groupId) addresses the editor of a specific group", async () => {
        const { stub, window } = makeCtx({ uri: B.toString(), groupId: 2 });
        // The host opened the file in group 2 (column 2); the snapshot is already applied by the time of the reply.
        stub.fire("editor.layoutChanged", {
            groups: [
                {
                    groupId: 2,
                    viewColumn: 2,
                    isActive: true,
                    tabs: [{ uri: B.toString(), label: "b.ts", isActive: true, isDirty: false, kind: "text" }],
                },
            ],
        });

        const editor = await window.showTextDocument(B, { viewColumn: 2 });

        expect(editor.document.uri.toString()).toBe(B.toString());
        expect(editor.viewColumn).toBe(2);
        expect(editor === window.visibleTextEditors[0]).toBe(true);
    });
});

describe("window.showWorkspaceFolderPick", () => {
    const folder = (name: string): vscode.WorkspaceFolder => ({ uri: Uri.file(`/ws/${name}`), name, index: 0 });

    function pick(
        folders: readonly vscode.WorkspaceFolder[] | undefined,
        chosenIndex: number | null,
        withFolders = true,
    ) {
        const stub = makeStubRpc();
        stub.responder = (method) =>
            method === "window.showQuickPick" ? { indices: chosenIndex === null ? null : [chosenIndex] } : undefined;
        const registry = new DocumentRegistry();
        const ctx: IVscodeHostContext = {
            rpc: stub.rpc,
            registry,
            documentSync: new DocumentSyncTracker(registry),
            configStore: new WorkspaceConfigStore(),
            disk: createNodeExtHostDisk(),
            owner: new ExtensionOwner(),
        };
        const window = createWindowNamespace(
            ctx,
            undefined,
            undefined,
            undefined,
            withFolders ? () => folders : undefined,
        );
        return { stub, window };
    }

    it("[api:window.showWorkspaceFolderPick] no folders: undefined and no picker", async () => {
        for (const folders of [undefined, []]) {
            const { stub, window } = pick(folders, 0);

            await expect(window.showWorkspaceFolderPick()).resolves.toBeUndefined();
            expect(stub.requests).toEqual([]);
        }
        // A window built without a folders getter at all (the default): the same.
        const { stub, window } = pick(undefined, 0, false);
        await expect(window.showWorkspaceFolderPick()).resolves.toBeUndefined();
        expect(stub.requests).toEqual([]);
    });

    it("[api:window.showWorkspaceFolderPick] one folder is still offered, as upstream, with its parent as the description", async () => {
        const only = folder("one");
        const { stub, window } = pick([only], 0);

        await expect(window.showWorkspaceFolderPick()).resolves.toBe(only);

        const request = stub.requests.find((r) => r.method === "window.showQuickPick")?.params as {
            items: { label: string; description?: string }[];
            placeHolder?: string;
        };
        expect(request.items[0]).toMatchObject({ label: "one", description: "/ws" });
        expect(request.placeHolder).toBe("Select workspace folder");
    });

    it("the placeholder of the options wins; cancelling gives undefined", async () => {
        const { stub, window } = pick([folder("one"), folder("two")], null);

        await expect(window.showWorkspaceFolderPick({ placeHolder: "Where?" })).resolves.toBeUndefined();

        const request = stub.requests.find((r) => r.method === "window.showQuickPick")?.params as {
            placeHolder?: string;
        };
        expect(request.placeHolder).toBe("Where?");
    });
});
