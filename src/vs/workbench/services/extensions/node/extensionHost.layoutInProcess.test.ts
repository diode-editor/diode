import { describe, expect, it } from "vitest";

import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";

import { ExtensionHost } from "./extensionHost.ts";

// A real subprocess sends only valid params; garbage is pushed through the RPC pair.

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
    listCommandIds: () => [],
    registerProxy: () => ({ dispose: () => undefined }),
} as unknown as ICommandService;

function makePeer(): RpcEndpoint {
    const host = new ExtensionHost(NOOP_EDITOR_OPTIONS, NOOP_COMMANDS, {});
    const [a, b] = createInProcessChannelPair();
    const hostRpc = new RpcEndpoint(a);
    const peer = new RpcEndpoint(b);
    (host as unknown as { installHostHandlers(rpc: RpcEndpoint): void }).installHostHandlers(hostRpc);
    return peer;
}

describe("ExtensionHost — group bar handlers (in-process)", () => {
    it("malformed show/close params are rejected with an error, not a silent success", async () => {
        const peer = makePeer();
        await expect(peer.request("editor.showTextDocument", { uri: 42 })).rejects.toThrow(
            "editor.showTextDocument: malformed params",
        );
        await expect(peer.request("editor.closeTabs", { tabs: "nope" })).rejects.toThrow(
            "editor.closeTabs: malformed params",
        );
        await expect(peer.request("editor.closeGroups", { groupIds: ["x"] })).rejects.toThrow(
            "editor.closeGroups: malformed params",
        );
    });

    it("without a group bar (NULL port): show is rejected, close answers false", async () => {
        const peer = makePeer();
        await expect(peer.request("editor.showTextDocument", { uri: "file:///a.ts" })).rejects.toThrow(
            "editor layout unavailable",
        );
        await expect(peer.request("workspace.createUntitledDocument", {})).rejects.toThrow("editor layout unavailable");
        await expect(peer.request("editor.closeTabs", { tabs: [] })).resolves.toBe(false);
        await expect(peer.request("editor.closeGroups", { groupIds: [] })).resolves.toBe(false);
    });
});
