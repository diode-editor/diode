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
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry),
        configStore: new WorkspaceConfigStore(),
        disk: createNodeExtHostDisk(),
        owner: new ExtensionOwner(),
    };
    return { stub, registry, workspace: createWorkspaceNamespace(ctx) };
}

function createRequests(stub: ReturnType<typeof makeStubRpc>): unknown[] {
    return stub.requests.filter((r) => r.method === "workspace.createUntitledDocument").map((r) => r.params);
}

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

    it("uri and path still do not create an untitled document", async () => {
        const { stub, workspace } = makeCtx();

        await expect(
            workspace.openTextDocument(Uri.parse("untitled:Other") as unknown as vscode.Uri),
        ).rejects.toMatchObject({ code: "Unavailable" });

        expect(createRequests(stub)).toEqual([]);
    });
});
