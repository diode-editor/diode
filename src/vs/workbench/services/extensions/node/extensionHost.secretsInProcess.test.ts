import { describe, expect, it } from "vitest";

import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";

import { ExtensionHost } from "./extensionHost.ts";
import { createInMemoryExtensionSecretStore, type IExtensionSecretStore } from "./extensionSecretsStore.ts";

// A live subprocess never sends a malformed request, and the refusal is the host's trust boundary.

const NOOP_EDITOR_OPTIONS = {
    getActiveEditorOptions: () => null,
    setActiveEditorOptions: () => undefined,
    getActiveEditorFilePath: () => null,
    getActiveEditorMeta: () => ({ uri: null, languageId: null, isDirty: false }),
    onActiveEditorChanged: () => ({ dispose: () => undefined }),
    onActiveEditorSelectionChanged: () => ({ dispose: () => undefined }),
    setActiveEditorSelections: () => undefined,
    applyActiveEditorEdits: () => true,
} as unknown as IEditorOptionsService;

const NOOP_COMMANDS = {
    execute: () => undefined,
    registerProxy: () => ({ dispose: () => undefined }),
} as unknown as ICommandService;

function makeHost(): { host: ExtensionHost; peer: RpcEndpoint; secrets: IExtensionSecretStore; changed: unknown[] } {
    const secrets = createInMemoryExtensionSecretStore();
    const host = new ExtensionHost(NOOP_EDITOR_OPTIONS, NOOP_COMMANDS, { secrets });
    const [a, b] = createInProcessChannelPair();
    const hostRpc = new RpcEndpoint(a);
    const peer = new RpcEndpoint(b);
    (host as unknown as { installHostHandlers(rpc: RpcEndpoint): void }).installHostHandlers(hostRpc);
    const changed: unknown[] = [];
    peer.handleNotification("secrets.changed", (params) => changed.push(params));
    return { host, peer, secrets, changed };
}

describe("ExtensionHost — secrets.* handlers (in-process)", () => {
    it("store puts into the store and notifies the subprocess", async () => {
        const h = makeHost();
        await h.peer.request("secrets.store", { extensionId: "pub.one", key: "token", value: "s3cr3t" });
        expect(h.secrets.get("pub.one", "token")).toBe("s3cr3t");
        expect(h.changed).toEqual([{ extensionId: "pub.one", key: "token" }]);
        h.host.dispose();
    });

    it("get returns the value, and absence as `null` (undefined does not survive JSON)", async () => {
        const h = makeHost();
        expect(await h.peer.request("secrets.get", { extensionId: "pub.one", key: "token" })).toEqual({ value: null });
        h.secrets.store("pub.one", "token", "s3cr3t");
        expect(await h.peer.request("secrets.get", { extensionId: "pub.one", key: "token" })).toEqual({
            value: "s3cr3t",
        });
        h.host.dispose();
    });

    it("delete removes the secret and notifies too", async () => {
        const h = makeHost();
        h.secrets.store("pub.one", "token", "s3cr3t");
        await h.peer.request("secrets.delete", { extensionId: "pub.one", key: "token" });
        expect(h.secrets.get("pub.one", "token")).toBeUndefined();
        expect(h.changed).toEqual([{ extensionId: "pub.one", key: "token" }]);
        h.host.dispose();
    });

    it("keys returns the extension's keys", async () => {
        const h = makeHost();
        h.secrets.store("pub.one", "token", "a");
        h.secrets.store("pub.two", "other", "b");
        expect(await h.peer.request("secrets.keys", { extensionId: "pub.one" })).toEqual({ keys: ["token"] });
        h.host.dispose();
    });

    it.each([
        ["secrets.get", {}],
        ["secrets.delete", { extensionId: "pub.one" }],
        ["secrets.store", { extensionId: "pub.one", key: "token" }],
        ["secrets.keys", { extensionId: "" }],
    ])("malformed %s is rejected, not silently swallowed", async (method, params) => {
        const h = makeHost();
        await expect(h.peer.request(method, params)).rejects.toThrow(new RegExp(method));
        h.host.dispose();
    });

    it("a shape rejection does not notify the subprocess of a change", async () => {
        const h = makeHost();
        await expect(h.peer.request("secrets.store", { extensionId: "pub.one", key: "token" })).rejects.toThrow();
        expect(h.changed).toEqual([]);
        h.host.dispose();
    });

    it("the rejection message does not contain the secret value", async () => {
        // Otherwise it would end up in the RPC log together with the error text.
        const h = makeHost();
        await expect(
            h.peer.request("secrets.store", { extensionId: "pub.one", key: 1, value: "s3cr3t" }),
        ).rejects.toThrow(expect.not.stringContaining("s3cr3t") as unknown as string);
        h.host.dispose();
    });
});
