import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { Uri } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";
import { createWorkspaceNamespace } from "./workspaceNamespace.ts";

/**
 * `openTextDocument(options?)` на стороне субпроцесса: опции уезжают хосту
 * запросом `workspace.createUntitledDocument`, документ берётся из реестра (его
 * туда кладёт `editor.didOpen`, приехавший раньше ответа). Весь провод до
 * вкладки — `extensionHost.untitledDocument.test.ts`.
 */

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

describe("WorkspaceNamespace — openTextDocument безымянного документа", () => {
    it("опции уезжают хосту, документ — открытый из реестра", async () => {
        const { stub, registry, workspace } = makeCtx();
        const open = registry.upsertFull({ uri: UNTITLED, languageId: "markdown", text: "# r", encoding: "utf8" });

        const doc = await workspace.openTextDocument({ content: "# r", language: "markdown", encoding: "utf8" });

        expect(doc).toBe(open);
        expect(createRequests(stub)).toStrictEqual([{ content: "# r", language: "markdown", encoding: "utf8" }]);
    });

    it("без аргумента — запрос без опций; поле не той формы не уезжает", async () => {
        const { stub, workspace } = makeCtx();

        await workspace.openTextDocument();
        await workspace.openTextDocument({ content: 1, language: "go" } as unknown as { content: string });

        await workspace.openTextDocument({ encoding: 8 } as unknown as { encoding: string });

        // Строго: поле `undefined` в запросе — тоже «уехало».
        expect(createRequests(stub)).toStrictEqual([{}, { language: "go" }, {}]);
    });

    it("документа нет в реестре (сверх порога синхронизации) — эфемерный с тем же текстом", async () => {
        const { registry, workspace } = makeCtx();

        const doc = await workspace.openTextDocument({ content: "a\r\nb" });

        expect(doc.uri.toString()).toBe(UNTITLED);
        expect(doc.isUntitled).toBe(true);
        expect(doc.getText()).toBe("a\r\nb");
        expect((doc as unknown as { encoding: string }).encoding).toBe("utf8");
        expect(registry.all()).toEqual([]);
    });

    it("uri и путь по-прежнему не создают безымянного документа", async () => {
        const { stub, workspace } = makeCtx();

        await expect(
            workspace.openTextDocument(Uri.parse("untitled:Other") as unknown as vscode.Uri),
        ).rejects.toMatchObject({ code: "Unavailable" });

        expect(createRequests(stub)).toEqual([]);
    });
});
