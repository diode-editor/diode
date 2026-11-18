import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { Uri } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";
import { createWorkspace } from "./workspaceNamespace.ts";

// The API commands' upstream `createModelReference`: Angular's embedded template provider keeps one uri and changes
// its text without `onDidChange`, so each command must read the provider again.

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
    let text = "one";
    workspace.registerTextDocumentContentProvider("foo", { provideTextDocumentContent: () => text });
    const events: string[] = [];
    workspace.onDidOpenTextDocument((doc) => events.push(`open ${doc.getText()}`));
    workspace.onDidCloseTextDocument((doc) => events.push(`close ${doc.getText()}`));
    return {
        stub,
        workspace,
        referenceDocument,
        events,
        setText: (next: string) => {
            text = next;
        },
    };
}

describe("workspace — document references of the API commands", () => {
    it("a provider's document nobody had open closes with its reference, the next one reads the provider again", async () => {
        const { workspace, referenceDocument, events, setText } = setup();

        const first = await referenceDocument(FOO);
        expect(first.document.getText()).toBe("one");
        expect(workspace.textDocuments).toContain(first.document);
        first.dispose();
        expect(workspace.textDocuments).not.toContain(first.document);

        setText("two");
        const second = await referenceDocument(FOO);
        expect(second.document.getText()).toBe("two");
        second.dispose();

        expect(events).toEqual(["open one", "close one", "open two", "close two"]);
    });

    it("the document stays open until the last of the overlapping references goes, a second dispose changes nothing", async () => {
        const { referenceDocument, events } = setup();

        const first = await referenceDocument(FOO);
        const second = await referenceDocument(FOO);
        first.dispose();
        first.dispose();
        expect(events).toEqual(["open one"]);

        second.dispose();
        expect(events).toEqual(["open one", "close one"]);
    });

    it("a document the extension opened itself stays open, after a command's own open and close too", async () => {
        const { workspace, referenceDocument, events } = setup();
        (await referenceDocument(FOO)).dispose();
        const opened = await workspace.openTextDocument(FOO);

        const reference = await referenceDocument(FOO);
        expect(reference.document).toBe(opened);
        reference.dispose();

        expect(events).toEqual(["open one", "close one", "open one"]);
        expect(workspace.textDocuments).toContain(opened);
    });

    it("a document a tab showed meanwhile belongs to the core and stays open", async () => {
        const { stub, workspace, referenceDocument, events } = setup();
        const reference = await referenceDocument(FOO);

        stub.fire("editor.didOpen", { uri: FOO.toString(), text: "one", languageId: "html", version: 1 });
        reference.dispose();

        expect(events).toEqual(["open one"]);
        expect(workspace.textDocuments).toContain(reference.document);
    });
});
