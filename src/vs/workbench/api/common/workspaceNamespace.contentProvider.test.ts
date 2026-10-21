import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { CancellationTokenSource } from "../../../base/common/cancellation.ts";
import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { EventEmitter, Uri } from "./vscodeTypes.ts";
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
    return { stub, workspace: createWorkspaceNamespace(ctx) };
}

function provider(content: string | undefined, changed?: EventEmitter<Uri>): vscode.TextDocumentContentProvider {
    return {
        ...(changed !== undefined ? { onDidChange: changed.event as unknown as vscode.Event<vscode.Uri> } : {}),
        provideTextDocumentContent: () => content,
    } as unknown as vscode.TextDocumentContentProvider;
}

const JDT = "jdt://contents/lib.jar/pkg/Foo.java";

describe("WorkspaceNamespace — registerTextDocumentContentProvider", () => {
    it("announces schemes to the host on register and on dispose", () => {
        const { stub, workspace } = makeCtx();

        const registration = workspace.registerTextDocumentContentProvider("jdt", provider("class Foo {}"));
        registration.dispose();

        expect(stub.notifies.filter((n) => n.method === "workspace.textDocumentContentProvidersChanged")).toEqual([
            { method: "workspace.textDocumentContentProvidersChanged", params: { schemes: ["jdt"] } },
            { method: "workspace.textDocumentContentProvidersChanged", params: { schemes: [] } },
        ]);
    });

    it("returns content on the host's reverse request", async () => {
        const { stub, workspace } = makeCtx();
        workspace.registerTextDocumentContentProvider("jdt", provider("class Foo {}"));

        const result = await stub.callRequest("workspace.provideTextDocumentContent", { uri: JDT });

        expect(result).toEqual({ content: "class Foo {}" });
    });

    it("host request cancellation reaches the provider's token", async () => {
        const { stub, workspace } = makeCtx();
        let seen: vscode.CancellationToken | undefined;
        workspace.registerTextDocumentContentProvider("jdt", {
            provideTextDocumentContent: (_uri: vscode.Uri, token: vscode.CancellationToken) => {
                seen = token;
                return "x";
            },
        } as unknown as vscode.TextDocumentContentProvider);

        const caller = new CancellationTokenSource();
        caller.cancel();
        await stub.callRequest("workspace.provideTextDocumentContent", { uri: JDT }, caller.token);

        expect(seen?.isCancellationRequested).toBe(true);
    });

    it("provider declines the resource: the reply is null, not an exception", async () => {
        const { stub, workspace } = makeCtx();
        workspace.registerTextDocumentContentProvider("jdt", provider(undefined));

        expect(await stub.callRequest("workspace.provideTextDocumentContent", { uri: JDT })).toEqual({ content: null });
    });

    it("scheme without a provider and a garbage uri: rejection with an explanation", async () => {
        const { stub, workspace } = makeCtx();
        workspace.registerTextDocumentContentProvider("jdt", provider("class Foo {}"));

        await expect(
            stub.callRequest("workspace.provideTextDocumentContent", { uri: "class:///Foo.class" }),
        ).rejects.toThrow(/no text document content provider for scheme "class"/u);
        await expect(stub.callRequest("workspace.provideTextDocumentContent", { uri: 42 })).rejects.toThrow(
            /uri must be a string/u,
        );
    });

    it("provider's onDidChange is sent to the host as a notification", () => {
        const { stub, workspace } = makeCtx();
        const changed = new EventEmitter<Uri>();
        workspace.registerTextDocumentContentProvider("jdt", provider("a", changed));

        changed.fire(Uri.parse(JDT));

        expect(stub.notifies.filter((n) => n.method === "workspace.textDocumentContentChanged")).toEqual([
            { method: "workspace.textDocumentContentChanged", params: { uri: Uri.parse(JDT).toString() } },
        ]);
    });

    it("openTextDocument for such a scheme asks the provider, not the disk", async () => {
        const { workspace } = makeCtx();
        workspace.registerTextDocumentContentProvider("jdt", provider("class Foo {}\nsecond\n"));

        const doc = await workspace.openTextDocument(Uri.parse(JDT) as unknown as vscode.Uri);

        expect(doc.getText()).toBe("class Foo {}\nsecond\n");
        expect(doc.uri.toString()).toBe(Uri.parse(JDT).toString());
        expect(doc.lineCount).toBe(3);
        // The provider returns text, not bytes: there is no source encoding — utf8, as upstream.
        expect(doc.encoding).toBe("utf8");
    });

    it("openTextDocument: provider declined yields FileNotFound, not a disk read", async () => {
        const { workspace } = makeCtx();
        workspace.registerTextDocumentContentProvider("jdt", provider(undefined));

        await expect(workspace.openTextDocument(Uri.parse(JDT) as unknown as vscode.Uri)).rejects.toMatchObject({
            code: "FileNotFound",
        });
    });

    it("openTextDocument of a scheme WITHOUT a provider stays an honest rejection", async () => {
        const { workspace } = makeCtx();

        await expect(
            workspace.openTextDocument(Uri.parse("class:///Foo.class") as unknown as vscode.Uri),
        ).rejects.toMatchObject({ code: "Unavailable" });
    });
});
