import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { Uri } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";
import { createWorkspaceNamespace } from "./workspaceNamespace.ts";

const UNTITLED = "untitled:Untitled-1";

function makeCtx() {
    const stub = makeStubRpc();
    stub.responder = (method) => (method === "workspace.createUntitledDocument" ? { uri: UNTITLED } : undefined);
    const registry = new DocumentRegistry();
    const documentSync = new DocumentSyncTracker(registry);
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync,
        configStore: new WorkspaceConfigStore(),
        disk: createNodeExtHostDisk(),
        owner: new ExtensionOwner(),
    };
    return { stub, registry, documentSync, workspace: createWorkspaceNamespace(ctx) };
}

function createRequests(stub: ReturnType<typeof makeStubRpc>): unknown[] {
    return stub.requests.filter((r) => r.method === "workspace.createUntitledDocument").map((r) => r.params);
}

describe("WorkspaceNamespace — document state from the host", () => {
    const STATE = { uri: UNTITLED, version: 1, isDirty: false, eol: 1 };

    it("an encoding reaches the document, a missing or malformed one keeps what it has", () => {
        const { stub, documentSync } = makeCtx();
        const doc = documentSync.open({ uri: UNTITLED, text: "x", encoding: "utf8" });
        const encoding = () => (doc as unknown as { encoding: string }).encoding;

        stub.fire("editor.didChangeDocumentState", { ...STATE, encoding: "windows1252" });
        expect(encoding()).toBe("windows1252");

        stub.fire("editor.didChangeDocumentState", STATE);
        expect(encoding()).toBe("windows1252");

        stub.fire("editor.didChangeDocumentState", { ...STATE, encoding: 8 });
        expect(encoding()).toBe("windows1252");
    });
});

describe("WorkspaceNamespace — openTextDocument for an untitled document", () => {
    it("options are sent to the host, the document is the opened one from the registry", async () => {
        const { stub, registry, workspace } = makeCtx();
        const open = registry.upsertFull({ uri: UNTITLED, languageId: "markdown", text: "# r", encoding: "utf8" });

        const doc = await workspace.openTextDocument({ content: "# r", language: "markdown", encoding: "utf8" });

        expect(doc).toBe(open);
        expect(createRequests(stub)).toStrictEqual([{ content: "# r", language: "markdown", encoding: "utf8" }]);
    });

    it("no argument sends a request without options; a field of the wrong shape is not sent", async () => {
        const { stub, workspace } = makeCtx();

        await workspace.openTextDocument();
        await workspace.openTextDocument({ content: 1, language: "go" } as unknown as { content: string });

        await workspace.openTextDocument({ encoding: 8 } as unknown as { encoding: string });

        // `toStrictEqual`: an `undefined` field in the request also counts as "sent".
        expect(createRequests(stub)).toStrictEqual([{}, { language: "go" }, {}]);
    });

    it("document missing from the registry (over the sync threshold) yields an ephemeral one with the same text", async () => {
        const { registry, workspace } = makeCtx();

        const doc = await workspace.openTextDocument({ content: "a\r\nb" });

        expect(doc.uri.toString()).toBe(UNTITLED);
        expect(doc.isUntitled).toBe(true);
        expect(doc.getText()).toBe("a\r\nb");
        expect((doc as unknown as { encoding: string }).encoding).toBe("utf8");
        expect((await workspace.openTextDocument()).getText()).toBe("");
        expect(registry.all()).toEqual([]);
    });

    it("an untitled uri goes to the host as is, an explicit encoding with it", async () => {
        const { stub, workspace } = makeCtx();

        await workspace.openTextDocument(Uri.parse("untitled:Other") as unknown as vscode.Uri);
        await workspace.openTextDocument(Uri.parse("untitled:Second") as unknown as vscode.Uri, {
            encoding: "windows1252",
        });

        // `toStrictEqual`: an `undefined` encoding in the request also counts as "sent".
        expect(createRequests(stub)).toStrictEqual([
            { uri: "untitled:Other" },
            { uri: "untitled:Second", encoding: "windows1252" },
        ]);
    });

    it("an untitled uri the host did not sync yields an empty ephemeral document under that uri", async () => {
        const { workspace } = makeCtx();
        const uri = Uri.parse("untitled:Other") as unknown as vscode.Uri;

        const doc = await workspace.openTextDocument(uri);

        expect(doc.uri.toString()).toBe("untitled:Other");
        expect(doc.getText()).toBe("");
        expect((doc as unknown as { encoding: string }).encoding).toBe("utf8");
    });

    it("the document the host opened comes from the registry under the uri the host answered with", async () => {
        const { stub, registry, workspace } = makeCtx();
        stub.responder = () => ({ uri: "untitled:Other" });
        const synced = registry.upsertFull({ uri: "untitled:Other", text: "synced" });

        const doc = await workspace.openTextDocument(Uri.parse("untitled:Other") as unknown as vscode.Uri);

        expect(doc).toBe(synced);
    });

    describe("a document that is already open", () => {
        const open = (ctx: ReturnType<typeof makeCtx>, uri: string, encoding?: string) =>
            ctx.workspace.openTextDocument(
                Uri.parse(uri) as unknown as vscode.Uri,
                ...(encoding === undefined ? [] : [{ encoding }]),
            );

        it("an untitled one without an encoding, or with its own, is answered without the host", async () => {
            const ctx = makeCtx();
            const doc = ctx.documentSync.open({ uri: "untitled:Other", text: "x", encoding: "utf8" });

            expect(await open(ctx, "untitled:Other")).toBe(doc);
            expect(await open(ctx, "untitled:Other", "utf8")).toBe(doc);
            expect(createRequests(ctx.stub)).toEqual([]);
        });

        it("an untitled one with another encoding goes to the host", async () => {
            const ctx = makeCtx();
            ctx.stub.responder = () => ({ uri: "untitled:Other" });
            const doc = ctx.documentSync.open({ uri: "untitled:Other", text: "x", encoding: "utf8" });

            expect(await open(ctx, "untitled:Other", "windows1252")).toBe(doc);
            expect(createRequests(ctx.stub)).toEqual([{ uri: "untitled:Other", encoding: "windows1252" }]);
        });

        it("a file with another encoding stays as it is: encodings of files are a later cluster", async () => {
            const ctx = makeCtx();
            const doc = ctx.documentSync.open({ uri: "file:///a.txt", text: "x", encoding: "utf8" });

            expect(await open(ctx, "file:///a.txt", "windows1252")).toBe(doc);
            expect(createRequests(ctx.stub)).toEqual([]);
        });
    });

    describe("a document that was closed", () => {
        // Nothing answers for these resources: what counts is the registry, not how the open ends.
        const openIgnoringFailure = async (ctx: ReturnType<typeof makeCtx>, uri: string): Promise<void> => {
            try {
                await ctx.workspace.openTextDocument(Uri.parse(uri) as unknown as vscode.Uri);
            } catch {
                return;
            }
        };

        const closed = (ctx: ReturnType<typeof makeCtx>, uri: string) => {
            const doc = ctx.documentSync.open({ uri, text: "x" });
            ctx.documentSync.close(Uri.parse(uri));
            return doc;
        };

        it("an untitled one opens as a new object, the held one stays closed", async () => {
            const ctx = makeCtx();
            ctx.stub.responder = () => ({ uri: "untitled:Other" });
            const held = closed(ctx, "untitled:Other");

            const doc = await ctx.workspace.openTextDocument(Uri.parse("untitled:Other") as unknown as vscode.Uri);

            expect(doc).not.toBe(held);
            expect(held.isClosed).toBe(true);
        });

        it("a file leaves the registry too, so its open cannot revive the held object", async () => {
            const ctx = makeCtx();
            const held = closed(ctx, "file:///missing-dir/a.txt");

            await openIgnoringFailure(ctx, "file:///missing-dir/a.txt");

            expect(ctx.registry.get(Uri.parse("file:///missing-dir/a.txt"))).not.toBe(held);
        });

        it("a document of another scheme keeps its registry entry", async () => {
            const ctx = makeCtx();
            const held = closed(ctx, "other:/a.txt");

            await openIgnoringFailure(ctx, "other:/a.txt");

            expect(ctx.registry.get(Uri.parse("other:/a.txt"))).toBe(held);
        });
    });
});
