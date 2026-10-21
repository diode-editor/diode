import { describe, expect, it } from "vitest";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { Uri } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";
import { createWorkspaceNamespace } from "./workspaceNamespace.ts";

function makeWorkspace() {
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
    const workspace = createWorkspaceNamespace(ctx);
    return { stub, workspace, registry };
}

describe("workspace.saveAll — RPC producer", () => {
    it("includeUntitled is sent only as true; the host response is the result", async () => {
        const { stub, workspace } = makeWorkspace();
        stub.responder = (method) => method === "workspace.saveAll";

        await expect(workspace.saveAll()).resolves.toBe(true);
        await expect(workspace.saveAll(false)).resolves.toBe(true);
        await expect(workspace.saveAll(true)).resolves.toBe(true);

        expect(stub.requests).toStrictEqual([
            { method: "workspace.saveAll", params: {} },
            { method: "workspace.saveAll", params: {} },
            { method: "workspace.saveAll", params: { includeUntitled: true } },
        ]);
    });

    it("a host refusal (false) reaches the extension", async () => {
        const { stub, workspace } = makeWorkspace();
        stub.responder = () => false;

        await expect(workspace.saveAll(false)).resolves.toBe(false);
    });
});

describe("workspace.save — RPC producer", () => {
    it("the resource is sent as a string, the saved one comes back as a Uri", async () => {
        const { stub, workspace } = makeWorkspace();
        const uri = Uri.file("/proj/main.go");
        stub.responder = (_method, params) => params;

        const saved = await workspace.save(uri);

        expect(stub.requests).toStrictEqual([{ method: "workspace.save", params: { uri: uri.toString() } }]);
        expect(saved).toBeInstanceOf(Uri);
        expect(saved?.toString()).toBe(uri.toString());
    });

    it("host null (not open, not saved) gives undefined", async () => {
        const { stub, workspace } = makeWorkspace();
        stub.responder = () => null;

        await expect(workspace.save(Uri.file("/proj/closed.go"))).resolves.toBeUndefined();
    });
});

describe("TextDocument.save — RPC producer", () => {
    it("goes through the same workspace.save; a response with uri gives true, null gives false", async () => {
        const { stub, registry } = makeWorkspace();
        const doc = registry.getOrCreate(Uri.parse("_claude_fs_right:/repo/a.ts"));

        stub.responder = (_method, params) => params;
        await expect(doc.save()).resolves.toBe(true);
        stub.responder = () => null;
        await expect(doc.save()).resolves.toBe(false);

        expect(stub.requests).toStrictEqual([
            { method: "workspace.save", params: { uri: "_claude_fs_right:/repo/a.ts" } },
            { method: "workspace.save", params: { uri: "_claude_fs_right:/repo/a.ts" } },
        ]);
    });
});
