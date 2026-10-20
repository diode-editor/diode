import { describe, expect, it } from "vitest";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { Uri } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";
import { createWorkspaceNamespace } from "./workspaceNamespace.ts";

// Продюсер RPC `workspace.saveAll` / `workspace.save`: вызов расширения — один
// запрос хосту с параметрами эталона, ответ хоста — результат вызова.

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

describe("workspace.saveAll — продюсер RPC", () => {
    it("includeUntitled уезжает только как true; ответ хоста — результат", async () => {
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

    it("отказ хоста (false) доезжает до расширения", async () => {
        const { stub, workspace } = makeWorkspace();
        stub.responder = () => false;

        await expect(workspace.saveAll(false)).resolves.toBe(false);
    });
});

describe("workspace.save — продюсер RPC", () => {
    it("ресурс уезжает строкой, сохранённый возвращается Uri", async () => {
        const { stub, workspace } = makeWorkspace();
        const uri = Uri.file("/proj/main.go");
        stub.responder = (_method, params) => params;

        const saved = await workspace.save(uri);

        expect(stub.requests).toStrictEqual([{ method: "workspace.save", params: { uri: uri.toString() } }]);
        expect(saved).toBeInstanceOf(Uri);
        expect(saved?.toString()).toBe(uri.toString());
    });

    it("null хоста (не открыт, не сохранился) — undefined", async () => {
        const { stub, workspace } = makeWorkspace();
        stub.responder = () => null;

        await expect(workspace.save(Uri.file("/proj/closed.go"))).resolves.toBeUndefined();
    });
});

describe("TextDocument.save — продюсер RPC", () => {
    it("уезжает тем же workspace.save; ответ с uri — true, null — false", async () => {
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
