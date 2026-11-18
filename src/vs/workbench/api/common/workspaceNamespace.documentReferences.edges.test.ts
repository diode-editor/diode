import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { Uri } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";
import { createWorkspace } from "./workspaceNamespace.ts";

// Edges of the API commands' document references, seen from an extension: what it opened itself is its own,
// whichever comes first, the command's reference or its openTextDocument.

const FOO = Uri.parse("foo://auth/template.html") as unknown as vscode.Uri;

function setup() {
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
    const { workspace, referenceDocument } = createWorkspace(ctx);
    workspace.registerTextDocumentContentProvider("foo", { provideTextDocumentContent: () => "one" });
    const events: string[] = [];
    workspace.onDidCloseTextDocument((doc) => events.push(`close ${doc.uri.toString()}`));
    return { workspace, referenceDocument, events };
}

describe("workspace — document references: an extension's own open", () => {
    it("a document the extension opens while a command holds it stays open after the command", async () => {
        const { workspace, referenceDocument, events } = setup();
        const reference = await referenceDocument(FOO);

        const opened = await workspace.openTextDocument(FOO);
        reference.dispose();

        expect(events).toEqual([]);
        expect(workspace.textDocuments).toContain(opened);
        expect(opened.isClosed).toBe(false);
    });
});
