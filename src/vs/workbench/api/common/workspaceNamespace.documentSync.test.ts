import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { Uri } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";
import { createWorkspaceNamespace } from "./workspaceNamespace.ts";

function makeCtx() {
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
    return { stub, ctx, workspace: createWorkspaceNamespace(ctx) };
}

const URI = "file:///proj/main.ts";

function openParams(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { uri: URI, languageId: "typescript", version: 1, text: "const a = 1;\n", ...overrides };
}

describe("WorkspaceNamespace — document sync (editor.didOpen)", () => {
    it("puts the full text in the registry with an explicit version and fires onDidOpenTextDocument", () => {
        const { stub, ctx, workspace } = makeCtx();
        const opened: vscode.TextDocument[] = [];
        workspace.onDidOpenTextDocument((doc) => opened.push(doc));

        stub.fire("editor.didOpen", openParams());

        expect(opened).toHaveLength(1);
        expect(opened[0].uri.toString()).toBe(URI);
        expect(opened[0].getText()).toBe("const a = 1;\n");
        expect(opened[0].version).toBe(1);
        expect(opened[0].languageId).toBe("typescript");
        // Identity is stable: the event carries the same object as the registry.
        expect(ctx.registry.get(Uri.parse(URI))).toBe(opened[0] as unknown);
        expect(workspace.textDocuments).toHaveLength(1);
    });

    it("repeated didOpen of the same resource does not duplicate the event but updates the text", () => {
        const { stub, ctx, workspace } = makeCtx();
        const opened: vscode.TextDocument[] = [];
        workspace.onDidOpenTextDocument((doc) => opened.push(doc));

        stub.fire("editor.didOpen", openParams());
        stub.fire("editor.didOpen", openParams({ version: 5, text: "fresh" }));

        expect(opened).toHaveLength(1);
        const doc = ctx.registry.get(Uri.parse(URI));
        expect(doc?.getText()).toBe("fresh");
        expect(doc?.version).toBe(5);
    });

    it("invalid params are dropped without an event", () => {
        const { stub, workspace } = makeCtx();
        const opened: vscode.TextDocument[] = [];
        workspace.onDidOpenTextDocument((doc) => opened.push(doc));

        stub.fire("editor.didOpen", null);
        stub.fire("editor.didOpen", openParams({ uri: "" }));
        stub.fire("editor.didOpen", openParams({ languageId: 42 }));
        stub.fire("editor.didOpen", openParams({ version: "1" }));
        stub.fire("editor.didOpen", openParams({ text: null }));

        expect(opened).toHaveLength(0);
        expect(workspace.textDocuments).toHaveLength(0);
    });

    it("isDirty from the snapshot reaches the document", () => {
        const { stub, ctx } = makeCtx();
        stub.fire("editor.didOpen", openParams({ isDirty: true }));
        expect(ctx.registry.get(Uri.parse(URI))?.isDirty).toBe(true);
    });
});

describe("WorkspaceNamespace — document sync (editor.didChange)", () => {
    it("fires onDidChangeTextDocument with one full-range edit of the old text", () => {
        const { stub, workspace } = makeCtx();
        const changes: vscode.TextDocumentChangeEvent[] = [];
        workspace.onDidChangeTextDocument((e) => changes.push(e));

        stub.fire("editor.didOpen", openParams({ text: "ab\ncd" }));
        stub.fire("editor.didChange", openParams({ version: 2, text: "xyz" }));

        expect(changes).toHaveLength(1);
        const event = changes[0];
        expect(event.document.getText()).toBe("xyz");
        expect(event.document.version).toBe(2);
        expect(event.reason).toBeUndefined();
        expect(event.contentChanges).toHaveLength(1);
        const change = event.contentChanges[0];
        // The range covers the WHOLE old text ("ab\ncd" — 2 lines).
        expect(change.range.start.line).toBe(0);
        expect(change.range.start.character).toBe(0);
        expect(change.range.end.line).toBe(1);
        expect(change.range.end.character).toBe(2);
        expect(change.rangeOffset).toBe(0);
        expect(change.rangeLength).toBe(5);
        expect(change.text).toBe("xyz");
    });

    it("model batch edits apply to the mirror and reach extensions as real contentChanges", () => {
        const { stub, workspace } = makeCtx();
        stub.fire("editor.didOpen", openParams());
        const events: vscode.TextDocumentChangeEvent[] = [];
        workspace.onDidChangeTextDocument((e) => events.push(e));

        stub.fire("editor.didChange", {
            uri: URI,
            version: 5,
            changes: [{ range: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } }, text: "b" }],
            isDirty: true,
        });

        expect(events).toHaveLength(1);
        expect(events[0].document.getText()).toBe("const b = 1;\n");
        expect(events[0].document.version).toBe(5);
        expect(events[0].document.isDirty).toBe(true);
        expect(events[0].contentChanges).toMatchObject([{ rangeOffset: 6, rangeLength: 1, text: "b" }]);
    });

    it("didChange of an unknown resource is an open: didOpen with the full text, not an edit", () => {
        // An LSP client must send didOpen to the server before any didChange —
        // the server silently drops a change event for an unannounced document.
        const { stub, workspace } = makeCtx();
        const opens: vscode.TextDocument[] = [];
        const changes: vscode.TextDocumentChangeEvent[] = [];
        workspace.onDidOpenTextDocument((doc) => opens.push(doc));
        workspace.onDidChangeTextDocument((e) => changes.push(e));

        stub.fire("editor.didChange", openParams({ version: 3, text: "new" }));

        expect(changes).toHaveLength(0);
        expect(opens).toHaveLength(1);
        expect(opens[0].getText()).toBe("new");
        expect(opens[0].version).toBe(3);
    });

    it("repeated didOpen with changed text is a didChange, not a second didOpen", () => {
        const { stub, workspace } = makeCtx();
        const opens: vscode.TextDocument[] = [];
        const changes: vscode.TextDocumentChangeEvent[] = [];
        workspace.onDidOpenTextDocument((doc) => opens.push(doc));
        workspace.onDidChangeTextDocument((e) => changes.push(e));

        stub.fire("editor.didOpen", openParams({ version: 1, text: "old" }));
        stub.fire("editor.didOpen", openParams({ version: 2, text: "new!" }));

        expect(opens).toHaveLength(1);
        expect(changes).toHaveLength(1);
        expect(changes[0].contentChanges[0].rangeLength).toBe(3);
        expect(changes[0].document.getText()).toBe("new!");
    });

    it("invalid params are dropped without an event", () => {
        const { stub, workspace } = makeCtx();
        const changes: vscode.TextDocumentChangeEvent[] = [];
        workspace.onDidChangeTextDocument((e) => changes.push(e));

        stub.fire("editor.didChange", "junk");

        expect(changes).toHaveLength(0);
    });
});

describe("WorkspaceNamespace — document sync (editor.didClose)", () => {
    it("closing an open document fires onDidCloseTextDocument and sets isClosed", () => {
        const { stub, ctx, workspace } = makeCtx();
        const closed: vscode.TextDocument[] = [];
        workspace.onDidCloseTextDocument((doc) => closed.push(doc));

        stub.fire("editor.didOpen", openParams());
        stub.fire("editor.didClose", { uri: URI });

        expect(closed).toHaveLength(1);
        expect(closed[0].isClosed).toBe(true);
        // The document stays in the registry — extensions may keep a reference.
        expect(ctx.registry.get(Uri.parse(URI)) === (closed[0] as unknown)).toBe(true);
    });

    it("invalid uri and unopened resource are ignored without an event", () => {
        const { stub, workspace } = makeCtx();
        const closed: vscode.TextDocument[] = [];
        workspace.onDidCloseTextDocument((doc) => closed.push(doc));

        stub.fire("editor.didClose", {});
        stub.fire("editor.didClose", { uri: 42 });
        stub.fire("editor.didClose", { uri: "" });
        stub.fire("editor.didClose", { uri: "file:///never-opened.ts" });

        expect(closed).toHaveLength(0);
    });

    it("after didClose, reopening fires didOpen again (LSP contract)", () => {
        const { stub, workspace } = makeCtx();
        const opened: vscode.TextDocument[] = [];
        workspace.onDidOpenTextDocument((doc) => opened.push(doc));

        stub.fire("editor.didOpen", openParams());
        stub.fire("editor.didClose", { uri: URI });
        stub.fire("editor.didOpen", openParams({ version: 2 }));

        expect(opened).toHaveLength(2);
        expect(opened[1].isClosed).toBe(false);
    });
});

describe("WorkspaceNamespace — document sync listeners", () => {
    // The host syncs every document regardless of listeners: skipping one would corrupt the mirror.
    it("subscribing and unsubscribing sends no updateSubscriptions", () => {
        const { stub, workspace } = makeCtx();

        workspace.onDidOpenTextDocument(() => undefined).dispose();
        workspace.onDidChangeTextDocument(() => undefined).dispose();

        expect(stub.notifies.filter((n) => n.method === "workspace.updateSubscriptions")).toEqual([]);
    });

    it("an unsubscribed listener receives no events", () => {
        const { stub, workspace } = makeCtx();
        const opened: vscode.TextDocument[] = [];
        const sub = workspace.onDidOpenTextDocument((doc) => opened.push(doc));
        sub.dispose();

        stub.fire("editor.didOpen", openParams());

        expect(opened).toHaveLength(0);
    });

    it("the subscription is pushed into the given disposables array and disposing it unsubscribes", () => {
        const { stub, workspace } = makeCtx();
        const opened: vscode.TextDocument[] = [];
        const disposables: vscode.Disposable[] = [];
        workspace.onDidOpenTextDocument((doc) => opened.push(doc), undefined, disposables);
        expect(disposables).toHaveLength(1);

        disposables[0].dispose();
        stub.fire("editor.didOpen", openParams());

        expect(opened).toHaveLength(0);
    });
});
