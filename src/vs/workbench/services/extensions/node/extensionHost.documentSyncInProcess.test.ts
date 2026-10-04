import { describe, expect, it } from "vitest";

import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";
import type { IWireDocumentSyncSnapshot } from "../../../api/common/wireTypes.ts";

import { ExtensionHost } from "./extensionHost.ts";

// Хост на in-process RPC-паре (как extensionHost.decorationsInProcess.test.ts):
// гейты document sync — у DocumentsCustomer (см. его тесты), здесь — только
// проводка хоста: didOpen/didClose ждут хоть одного активного расширения.

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

const SNAPSHOT: IWireDocumentSyncSnapshot = { uri: "file:///a.ts", languageId: "typescript", version: 1, text: "x" };

describe("ExtensionHost — document sync (in-process)", () => {
    it("живой спавн без активных расширений didOpen/didClose не шлёт; с расширением — шлёт", async () => {
        const host = new ExtensionHost(NOOP_EDITOR_OPTIONS, NOOP_COMMANDS);
        const [a, b] = createInProcessChannelPair();
        const peer = new RpcEndpoint(b);
        const received: string[] = [];
        peer.handleNotification("editor.didOpen", () => received.push("didOpen"));
        peer.handleNotification("editor.didClose", () => received.push("didClose"));
        (host as unknown as { installHostHandlers(rpc: RpcEndpoint): void }).installHostHandlers(new RpcEndpoint(a));

        host.didOpenTextDocument(SNAPSHOT);
        host.didCloseTextDocument(SNAPSHOT.uri);
        await flushMicrotasks();
        expect(received).toEqual([]);

        // Активированное расширение попадает в `extensions` (см. activateRegistration).
        (host as unknown as { extensions: Set<string> }).extensions.add("test.fixture");
        host.didOpenTextDocument(SNAPSHOT);
        host.didCloseTextDocument(SNAPSHOT.uri);
        await flushMicrotasks();
        expect(received).toEqual(["didOpen", "didClose"]);
    });
});
