import { describe, expect, it } from "vitest";

import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";
import type { IWireDocumentSyncSnapshot } from "../../../api/common/wireTypes.ts";

import { ExtensionHost } from "./extensionHost.ts";

// Хост на in-process RPC-паре (как extensionHost.decorationsInProcess.test.ts):
// правила document sync — у DocumentsCustomer (см. его тесты), здесь — только
// проводка фасада хоста к нему.

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
    it("хост проводит открытие, правки дельтой и закрытие живому спавну", async () => {
        const host = new ExtensionHost(NOOP_EDITOR_OPTIONS, NOOP_COMMANDS);
        const [a, b] = createInProcessChannelPair();
        const peer = new RpcEndpoint(b);
        const received: string[] = [];
        for (const method of ["editor.didOpen", "editor.didChange", "editor.didClose"]) {
            peer.handleNotification(method, () => received.push(method));
        }
        // До спавна слать некому.
        host.didOpenTextDocument(SNAPSHOT);
        (host as unknown as { installHostHandlers(rpc: RpcEndpoint): void }).installHostHandlers(new RpcEndpoint(a));

        host.didOpenTextDocument(SNAPSHOT);
        host.didChangeTextDocumentContent({ uri: SNAPSHOT.uri, version: 2, changes: [] });
        host.didChangeTextDocument({ ...SNAPSHOT, version: 3 });
        host.didCloseTextDocument(SNAPSHOT.uri);
        await flushMicrotasks();
        expect(received).toEqual(["editor.didOpen", "editor.didChange", "editor.didChange", "editor.didClose"]);
    });
});
