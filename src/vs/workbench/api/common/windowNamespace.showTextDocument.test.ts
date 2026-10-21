import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { Range, Uri } from "./vscodeTypes.ts";
import { createWindowNamespace } from "./windowNamespace.ts";
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
