import { describe, expect, it } from "vitest";

import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";

import { ExtensionHost } from "./extensionHost.ts";

// Детерминированный in-process тест валидации хостовых обработчиков
// `editor.showTextDocument`/`closeTabs`/`closeGroups` (как
// extensionHost.documentSyncGate.test.ts): реальный субпроцесс шлёт только
// корректные параметры (их формирует vscodeNamespace), поэтому мусор в провод
// кладём напрямую через RPC-пару. Заодно фиксируем контракт
// NULL_EDITOR_LAYOUT_SERVICE — дефолтного порта хоста без полосы групп.

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

function makePeer(): RpcEndpoint {
    const host = new ExtensionHost(NOOP_EDITOR_OPTIONS, NOOP_COMMANDS, {});
    const [a, b] = createInProcessChannelPair();
    const hostRpc = new RpcEndpoint(a);
    const peer = new RpcEndpoint(b);
    (host as unknown as { installHostHandlers(rpc: RpcEndpoint): void }).installHostHandlers(hostRpc);
    return peer;
}

describe("ExtensionHost — обработчики полосы групп (in-process)", () => {
    it("малформленные параметры show/close отвергаются ошибкой, а не тихим успехом", async () => {
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

    it("без полосы групп (NULL-порт): show отвергается, close отвечает false", async () => {
        const peer = makePeer();
        await expect(peer.request("editor.showTextDocument", { uri: "file:///a.ts" })).rejects.toThrow(
            "editor layout unavailable",
        );
        await expect(peer.request("editor.closeTabs", { tabs: [] })).resolves.toBe(false);
        await expect(peer.request("editor.closeGroups", { groupIds: [] })).resolves.toBe(false);
    });
});
