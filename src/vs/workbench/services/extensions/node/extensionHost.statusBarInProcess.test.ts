import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";
import type { IWireStatusBarItem } from "../../../api/common/wireTypes.ts";

import { ExtensionHost, type IStatusBarItemSink } from "./extensionHost.ts";

// Детерминированный in-process тест стока пунктов статус-бара
// (`window.statusBarItem.*`): вместо форка subprocess'а гоняем
// `installHostHandlers` на in-process RPC-паре (паттерн
// extensionHost.diagnostics.test.ts).

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

const ITEM: IWireStatusBarItem = { handle: 1, id: "demo", alignment: "right", text: "Demo" };

function makeHost(withSink: boolean) {
    const updates: IWireStatusBarItem[] = [];
    const removed: number[] = [];
    const sink: IStatusBarItemSink = {
        update: (item) => updates.push(item),
        remove: (handle) => removed.push(handle),
        // Снятие всех пунктов идёт не через RPC, а при смерти субпроцесса —
        // его проверяет extensionHost.statusBar.test.ts на живом субпроцессе.
        clear: () => undefined,
    };
    // Логгер RPC ловит исключения хендлеров нотификаций (они там глотаются
    // молча) — по нему видно, что битый конверт или отсутствующий сток не
    // уронили обработчик.
    const rpcLogger = {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    } as unknown as ILogger;
    const host = new ExtensionHost(NOOP_EDITOR_OPTIONS, NOOP_COMMANDS, withSink ? { statusBarItemSink: sink } : {});
    const [a, b] = createInProcessChannelPair();
    const hostRpc = new RpcEndpoint(a, rpcLogger);
    const peer = new RpcEndpoint(b);
    (host as unknown as { installHostHandlers(rpc: RpcEndpoint): void }).installHostHandlers(hostRpc);
    return { host, peer, updates, removed, rpcLogger };
}

describe("ExtensionHost — сток пунктов статус-бара (in-process)", () => {
    it("валидный конверт доезжает до стока целиком", async () => {
        const h = makeHost(true);
        h.peer.notify("window.statusBarItem.update", {
            ...ITEM,
            priority: 100,
            name: "Status Bar Demo",
            command: "demo.click",
            arguments: [1],
        });
        h.peer.notify("window.statusBarItem.dispose", { handle: 1 });
        await flushMicrotasks();

        expect(h.updates).toEqual([
            {
                handle: 1,
                id: "demo",
                alignment: "right",
                text: "Demo",
                priority: 100,
                name: "Status Bar Demo",
                command: "demo.click",
                arguments: [1],
            },
        ]);
        expect(h.removed).toEqual([1]);
    });

    it("битый конверт до стока не доезжает и обработчик не роняет", async () => {
        const h = makeHost(true);
        h.peer.notify("window.statusBarItem.update", null);
        h.peer.notify("window.statusBarItem.update", { ...ITEM, id: "" });
        h.peer.notify("window.statusBarItem.update", { ...ITEM, alignment: "top" });
        h.peer.notify("window.statusBarItem.dispose", { handle: "1" });
        h.peer.notify("window.statusBarItem.dispose", null);
        await flushMicrotasks();

        expect(h.updates).toEqual([]);
        expect(h.removed).toEqual([]);
        expect(h.rpcLogger.warn).not.toHaveBeenCalled();
    });

    it("без стока пункты отбрасываются, обработчик не роняет", async () => {
        const h = makeHost(false);
        h.peer.notify("window.statusBarItem.update", ITEM);
        h.peer.notify("window.statusBarItem.dispose", { handle: 1 });
        await flushMicrotasks();

        expect(h.updates).toEqual([]);
        expect(h.rpcLogger.warn).not.toHaveBeenCalled();
    });
});
