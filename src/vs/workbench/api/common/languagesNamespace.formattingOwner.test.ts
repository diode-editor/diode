import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

function makeCtx(): { stub: IStubRpc; languages: typeof vscode.languages; owner: ExtensionOwner } {
    const stub = makeStubRpc();
    const registry = new DocumentRegistry();
    const owner = new ExtensionOwner();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry, () => undefined),
        configStore: new WorkspaceConfigStore(),
        disk: createNodeExtHostDisk(),
        owner,
    };
    const { languages } = createLanguagesNamespace(ctx, {
        applyEdit: () => Promise.resolve(true),
        executeCommand: () => Promise.resolve(undefined),
        hasCommand: () => Promise.resolve(false),
    });
    return { stub, languages, owner };
}

describe("formatter registration carries the extension that registered it", () => {
    it("[api:languages.registerDocumentFormattingEditProvider] [api:languages.registerDocumentRangeFormattingEditProvider] sends the owner's id", () => {
        const { stub, languages, owner } = makeCtx();
        owner.runAs("acme.fmt", () => {
            languages.registerDocumentFormattingEditProvider("*", { provideDocumentFormattingEdits: () => [] });
            languages.registerDocumentRangeFormattingEditProvider("*", {
                provideDocumentRangeFormattingEdits: () => [],
            });
        });
        const sent = stub.notifies
            .filter((n) => n.method === "languages.register")
            .map((n) => n.params as { kind: string; extensionId?: string });
        expect(sent.map(({ kind, extensionId }) => [kind, extensionId])).toEqual([
            ["formatting", "acme.fmt"],
            ["rangeFormatting", "acme.fmt"],
        ]);
    });
});
