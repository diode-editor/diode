import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { flushMicrotasks } from "../../../../TestUtils/timing.ts";
import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { EventEmitter, Uri } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";
import { createWorkspaceNamespace } from "./workspaceNamespace.ts";

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
    return { stub, documentSync: ctx.documentSync, workspace: createWorkspaceNamespace(ctx) };
}

const FOO = Uri.parse("foo://auth/doc.json") as unknown as vscode.Uri;

function counting(
    answer: () => string,
    onDidChange?: EventEmitter<Uri>,
): vscode.TextDocumentContentProvider & { calls: () => number } {
    let calls = 0;
    return {
        calls: () => calls,
        ...(onDidChange !== undefined ? { onDidChange: onDidChange.event as unknown as vscode.Event<vscode.Uri> } : {}),
        provideTextDocumentContent: () => {
            calls++;
            return answer();
        },
    };
}

describe("workspace — documents of a content provider", () => {
    it("[api:workspace.registerTextDocumentContentProvider] an open virtual document is live: listed, one object, opened once", async () => {
        const { workspace } = setup();
        const provider = counting(() => "virtual");
        workspace.registerTextDocumentContentProvider("foo", provider);
        const opened: vscode.TextDocument[] = [];
        workspace.onDidOpenTextDocument((doc) => opened.push(doc));

        const [first, second] = await Promise.all([workspace.openTextDocument(FOO), workspace.openTextDocument(FOO)]);

        expect(first).toBe(second);
        expect(first.getText()).toBe("virtual");
        expect(provider.calls()).toBe(1);
        expect(opened).toEqual([first]);
        expect(workspace.textDocuments).toContain(first);
    });

    it("a provider event reads the text again and fires onDidChangeTextDocument on the same object", async () => {
        const { workspace } = setup();
        const changed = new EventEmitter<Uri>();
        let text = "one";
        workspace.registerTextDocumentContentProvider(
            "foo",
            counting(() => text, changed),
        );
        const doc = await workspace.openTextDocument(FOO);
        const seen: string[] = [];
        workspace.onDidChangeTextDocument((event) => {
            expect(event.document).toBe(doc);
            seen.push(event.document.getText());
        });

        text = "two";
        changed.fire(FOO as unknown as Uri);
        await flushMicrotasks();

        expect(seen).toEqual(["two"]);
    });

    it("refreshes run one at a time, in order, and a failed one keeps the old text", async () => {
        const { workspace } = setup();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const changed = new EventEmitter<Uri>();
        const answers: (() => string)[] = [
            () => "initial",
            () => {
                throw new Error("boom");
            },
            () => "after failure",
        ];
        workspace.registerTextDocumentContentProvider(
            "foo",
            counting(() => (answers.shift() as () => string)(), changed),
        );
        const doc = await workspace.openTextDocument(FOO);

        changed.fire(FOO as unknown as Uri);
        await flushMicrotasks();
        expect(doc.getText()).toBe("initial");
        expect(warn).toHaveBeenCalledTimes(1);

        changed.fire(FOO as unknown as Uri);
        await flushMicrotasks();
        expect(doc.getText()).toBe("after failure");
        warn.mockRestore();
    });

    it("once a tab shows the document the core re-reads it, the subprocess does not ask the provider too", async () => {
        const { stub, workspace } = setup();
        const changed = new EventEmitter<Uri>();
        const provider = counting(() => "text", changed);
        workspace.registerTextDocumentContentProvider("foo", provider);
        await workspace.openTextDocument(FOO);

        stub.fire("editor.didOpen", { uri: FOO.toString(), text: "text", languageId: "json", version: 1 });
        changed.fire(FOO as unknown as Uri);
        await flushMicrotasks();

        expect(provider.calls()).toBe(1);
        expect(stub.notifies).toContainEqual({
            method: "workspace.textDocumentContentChanged",
            params: { uri: FOO.toString() },
        });
    });

    it("an event for a document nobody opened asks no provider", async () => {
        const { workspace } = setup();
        const changed = new EventEmitter<Uri>();
        const provider = counting(() => "text", changed);
        workspace.registerTextDocumentContentProvider("foo", provider);

        changed.fire(FOO as unknown as Uri);
        await flushMicrotasks();

        expect(provider.calls()).toBe(0);
    });

    it("a document closed with its tab is read again on the next open, as the same object", async () => {
        const { stub, workspace } = setup();
        let text = "before";
        workspace.registerTextDocumentContentProvider(
            "foo",
            counting(() => text),
        );
        const doc = await workspace.openTextDocument(FOO);
        stub.fire("editor.didOpen", { uri: FOO.toString(), text: "before", languageId: "json", version: 1 });
        stub.fire("editor.didClose", { uri: FOO.toString() });
        expect(doc.isClosed).toBe(true);

        text = "after";
        const again = await workspace.openTextDocument(FOO);

        expect(again).toBe(doc);
        expect(again.isClosed).toBe(false);
        expect(again.getText()).toBe("after");
    });

    it("[api:workspace.registerTextDocumentContentProvider] no provider answered: opening fails, and the next open asks again", async () => {
        const { workspace } = setup();
        const provider = {
            calls: 0,
            provideTextDocumentContent(): undefined {
                this.calls++;
                return undefined;
            },
        };
        workspace.registerTextDocumentContentProvider("foo", provider);

        await expect(workspace.openTextDocument(FOO)).rejects.toThrow();
        await expect(workspace.openTextDocument(FOO)).rejects.toThrow();

        expect(provider.calls).toBe(2);
        expect(workspace.textDocuments).toEqual([]);
    });

    it("the language comes from the host, a virtual document included", async () => {
        const { stub, workspace } = setup();
        stub.responder = (method) =>
            method === "languages.getLanguageOfDocument" ? { languageId: "json" } : undefined;
        workspace.registerTextDocumentContentProvider(
            "foo",
            counting(() => "{}"),
        );

        const doc = await workspace.openTextDocument(FOO);

        expect(doc.languageId).toBe("json");
        expect(stub.requests).toContainEqual({
            method: "languages.getLanguageOfDocument",
            params: { uri: FOO.toString() },
        });
    });

    it("no language known to the host leaves plaintext", async () => {
        const { stub, workspace } = setup();
        stub.responder = (method) => (method === "languages.getLanguageOfDocument" ? { languageId: null } : undefined);
        workspace.registerTextDocumentContentProvider(
            "foo",
            counting(() => "{}"),
        );

        expect((await workspace.openTextDocument(FOO)).languageId).toBe("plaintext");
    });

    it("[api:workspace.rootPath] is the path of the first folder, undefined without folders, and read-only", () => {
        const { stub, workspace } = setup();
        const api = workspace as unknown as { rootPath: string | undefined };
        expect(api.rootPath).toBeUndefined();

        stub.fire("workspace.initialize", {
            workspaceFolders: [
                { uri: "file:///ws/one", name: "one", index: 0 },
                { uri: "file:///ws/two", name: "two", index: 1 },
            ],
        });

        expect(api.rootPath).toBe("/ws/one");
        expect(() => {
            api.rootPath = "/elsewhere";
        }).toThrow("rootPath is read-only");
    });
});

describe("DocumentSyncTracker.changeLanguage", () => {
    it("a document the tracker holds is closed with the old language and opened with the new one, same object and text", async () => {
        const { documentSync, workspace } = setup();
        workspace.registerTextDocumentContentProvider(
            "foo",
            counting(() => "text"),
        );
        const doc = (await workspace.openTextDocument(FOO)) as Parameters<typeof documentSync.changeLanguage>[0];
        const events: string[] = [];
        workspace.onDidCloseTextDocument((closed) => {
            expect(closed).toBe(doc);
            events.push(`close ${closed.languageId} ${String(closed.isClosed)}`);
        });
        workspace.onDidOpenTextDocument((opened) => {
            expect(opened).toBe(doc);
            events.push(`open ${opened.languageId} ${String(opened.isClosed)}`);
        });

        documentSync.changeLanguage(doc, "json");

        expect(events).toEqual(["close plaintext true", "open json false"]);
        expect(doc.getText()).toBe("text");
    });

    it("a document outside the tracker fires the same pair and stays out of textDocuments", () => {
        const { documentSync, workspace } = setup();
        const doc = { uri: FOO, languageId: "plaintext", applyMeta: vi.fn() } as unknown as Parameters<
            typeof documentSync.changeLanguage
        >[0];
        const events: string[] = [];
        workspace.onDidCloseTextDocument(() => events.push("close"));
        workspace.onDidOpenTextDocument(() => events.push("open"));

        documentSync.changeLanguage(doc, "json");

        expect(events).toEqual(["close", "open"]);
        expect(doc.applyMeta).toHaveBeenCalledWith({ uri: FOO.toString(), languageId: "json" });
        expect(workspace.textDocuments).toEqual([]);
    });
});
