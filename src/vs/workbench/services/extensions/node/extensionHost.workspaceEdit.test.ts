import { describe, expect, it } from "vitest";

import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";
import type { IWireWorkspaceEditOp } from "../../../api/common/wireTypes.ts";

import { ExtensionHost } from "./extensionHost.ts";

// Консьюмер RPC `workspace.applyEdit`: host-хендлер парсит wire-параметры и
// отдаёт их в порт `IEditorOptionsService.applyWorkspaceEdit`, возвращая его
// вердикт субпроцессу. In-process RPC-пара — как в decorations-тестах.

const NOOP_COMMANDS = {
    execute: () => undefined,
    registerProxy: () => ({ dispose: () => undefined }),
} as unknown as ICommandService;

const NOOP_LOGGER = {
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    isEnabled: () => true,
} as unknown as ILogger;

function makeHost(applyResult: boolean) {
    const applied: (readonly IWireWorkspaceEditOp[])[] = [];
    const editorOptions = {
        getActiveEditorOptions: () => null,
        setActiveEditorOptions: () => undefined,
        getActiveEditorFilePath: () => null,
        getActiveEditorMeta: () => ({ uri: null, languageId: null, isDirty: false }),
        onActiveEditorChanged: () => ({ dispose: () => undefined }),
        onActiveEditorSelectionChanged: () => ({ dispose: () => undefined }),
        setActiveEditorSelections: () => undefined,
        applyActiveEditorEdits: () => false,
        applyWorkspaceEdit: (ops: readonly IWireWorkspaceEditOp[]) => {
            applied.push(ops);
            return applyResult;
        },
    } as unknown as IEditorOptionsService;

    const host = new ExtensionHost(editorOptions, NOOP_COMMANDS, { logger: NOOP_LOGGER });
    const [a, b] = createInProcessChannelPair();
    const hostRpc = new RpcEndpoint(a);
    const peer = new RpcEndpoint(b);
    (host as unknown as { installHostHandlers(rpc: RpcEndpoint): void }).installHostHandlers(hostRpc);
    return { peer, applied };
}

const WIRE_EDIT = { range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 2 }, text: "hi" };

describe("ExtensionHost — workspace.applyEdit", () => {
    it("парсит операции, отдаёт их в порт в исходном порядке и возвращает его вердикт", async () => {
        const { peer, applied } = makeHost(true);
        const result = await peer.request("workspace.applyEdit", {
            ops: [
                { kind: "create", resource: "file:///b.ts" },
                { kind: "text", resource: "file:///a.ts", edits: [WIRE_EDIT] },
                { kind: "rename", from: "file:///a.ts", to: "file:///c.ts" },
                { kind: "delete", resource: "file:///d.ts" },
            ],
        });
        expect(result).toBe(true);
        expect(applied).toEqual([
            [
                { kind: "create", resource: "file:///b.ts" },
                { kind: "text", resource: "file:///a.ts", edits: [WIRE_EDIT] },
                { kind: "rename", from: "file:///a.ts", to: "file:///c.ts" },
                { kind: "delete", resource: "file:///d.ts" },
            ],
        ]);
    });

    it("отказ порта уезжает субпроцессу как false", async () => {
        const { peer } = makeHost(false);
        const result = await peer.request("workspace.applyEdit", {
            ops: [{ kind: "text", resource: "file:///closed.ts", edits: [WIRE_EDIT] }],
        });
        expect(result).toBe(false);
    });

    it("мусор в параметрах — false без обращения к порту (edit all-or-nothing)", async () => {
        const { peer, applied } = makeHost(true);
        // Мусорная операция рядом с валидной отбивает ВЕСЬ набор: применить
        // половину workspace edit'а нельзя.
        const result = await peer.request("workspace.applyEdit", {
            ops: [
                { kind: "text", resource: "file:///a.ts", edits: [WIRE_EDIT] },
                { kind: "text", resource: 42 },
            ],
        });
        expect(result).toBe(false);
        expect(applied).toEqual([]);
    });

    it("пустой набор операций доезжает до порта (вердикт — его)", async () => {
        const { peer, applied } = makeHost(false);
        expect(await peer.request("workspace.applyEdit", { ops: [] })).toBe(false);
        expect(applied).toEqual([[]]);
    });
});
