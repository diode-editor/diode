import { describe, expect, it } from "vitest";

import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";
import type { IWireDocumentSyncSnapshot } from "../../../api/common/wireTypes.ts";

import { ExtensionHost } from "./extensionHost.ts";

// Детерминированный in-process тест гейтов document sync push'а: вместо форка
// subprocess'а гоняем `installHostHandlers` на in-process RPC-паре (как
// extensionHost.decorationsInProcess.test.ts). Так стабильно пробиваются
// guard-ветки: нет подписки, нет rpc, лимит размера, коалесинг в тик.

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

function makeLogger(): { logger: ILogger; lines: string[] } {
    const lines: string[] = [];
    const log = (level: string) => (msg: string) => lines.push(`${level}:${msg}`);
    const logger = {
        trace: log("trace"),
        debug: log("debug"),
        info: log("info"),
        warn: log("warn"),
        error: log("error"),
        isEnabled: () => true,
    } as unknown as ILogger;
    return { logger, lines };
}

function makeHost(options: { provider?: () => IWireDocumentSyncSnapshot | null; withRpc?: boolean } = {}) {
    const { logger, lines } = makeLogger();
    const host = new ExtensionHost(NOOP_EDITOR_OPTIONS, NOOP_COMMANDS, {
        logger,
        ...(options.provider !== undefined ? { activeDocumentProvider: options.provider } : {}),
    });
    const [a, b] = createInProcessChannelPair();
    const hostRpc = new RpcEndpoint(a);
    const peer = new RpcEndpoint(b);
    (host as unknown as { installHostHandlers(rpc: RpcEndpoint): void }).installHostHandlers(hostRpc);
    if (options.withRpc !== false) {
        // installHostHandlers не выставляет this.rpc (это делает ensureSubprocess) —
        // подставляем вручную, чтобы host мог слать нотификации субпроцессу.
        (host as unknown as { rpc: RpcEndpoint | null }).rpc = hostRpc;
    }
    const received: { method: string; params: unknown }[] = [];
    peer.handleNotification("editor.didOpen", (p) => received.push({ method: "editor.didOpen", params: p }));
    peer.handleNotification("editor.didChange", (p) => received.push({ method: "editor.didChange", params: p }));
    return { host, peer, received, logLines: lines };
}

function snap(text = "hello", version = 1): IWireDocumentSyncSnapshot {
    return { uri: "file:///a.ts", languageId: "typescript", version, text };
}

async function subscribe(h: ReturnType<typeof makeHost>): Promise<void> {
    h.peer.notify("workspace.updateSubscriptions", { willSave: false, didSave: false, documentSync: true });
    await flushMicrotasks();
}

describe("ExtensionHost — гейты document sync push'а (in-process)", () => {
    it("без rpc и без подписки push не гоняется; подписка включает его", async () => {
        const noRpc = makeHost({ withRpc: false });
        noRpc.host.didOpenTextDocument(snap());
        noRpc.host.didChangeTextDocument(snap());
        await flushMicrotasks();
        expect(noRpc.received).toHaveLength(0);

        const h = makeHost();
        h.host.didOpenTextDocument(snap());
        h.host.didChangeTextDocument(snap());
        await flushMicrotasks();
        expect(h.received).toHaveLength(0);

        await subscribe(h);
        h.host.didOpenTextDocument(snap());
        h.host.didChangeTextDocument(snap("hello!", 2));
        await flushMicrotasks();
        expect(h.received.map((r) => r.method)).toEqual(["editor.didOpen", "editor.didChange"]);
    });

    it("переход подписки 0→1 доталкивает активный документ провайдера, повторный true — нет", async () => {
        const h = makeHost({ provider: () => snap("provided", 7) });
        await subscribe(h);
        expect(h.received).toEqual([{ method: "editor.didOpen", params: snap("provided", 7) }]);

        // Подписка уже была — транзишена нет, повторного push'а нет.
        await subscribe(h);
        expect(h.received).toHaveLength(1);

        // Сброс и новый переход 0→1 — снова push.
        h.peer.notify("workspace.updateSubscriptions", { willSave: false, didSave: false, documentSync: false });
        await subscribe(h);
        expect(h.received).toHaveLength(2);
    });

    it("переход 0→1 без активного документа (провайдер вернул null / не передан) — без push'а", async () => {
        const withNull = makeHost({ provider: () => null });
        await subscribe(withNull);
        expect(withNull.received).toHaveLength(0);

        const withoutProvider = makeHost();
        await subscribe(withoutProvider);
        expect(withoutProvider.received).toHaveLength(0);
    });

    it("didChange коалесируется в пределах тика: последний снапшот побеждает", async () => {
        const h = makeHost();
        await subscribe(h);

        h.host.didChangeTextDocument(snap("a", 2));
        h.host.didChangeTextDocument(snap("ab", 3));
        h.host.didChangeTextDocument(snap("abc", 4));
        await flushMicrotasks();

        const changes = h.received.filter((r) => r.method === "editor.didChange");
        expect(changes).toEqual([{ method: "editor.didChange", params: snap("abc", 4) }]);

        // Следующий тик — отдельная нотификация.
        h.host.didChangeTextDocument(snap("abcd", 5));
        await flushMicrotasks();
        expect(h.received.filter((r) => r.method === "editor.didChange")).toHaveLength(2);
    });

    it("отложенный didChange не отправляется, если host успели закрыть", async () => {
        const h = makeHost();
        await subscribe(h);

        h.host.didChangeTextDocument(snap("late", 2));
        h.host.dispose();
        await flushMicrotasks();

        expect(h.received.filter((r) => r.method === "editor.didChange")).toHaveLength(0);
    });

    it("слишком большой документ не пушится и логируется", async () => {
        const h = makeHost();
        await subscribe(h);

        const huge = "x".repeat(8 * 1024 * 1024 + 1);
        h.host.didOpenTextDocument(snap(huge));
        await flushMicrotasks();

        expect(h.received).toHaveLength(0);
        expect(h.logLines.some((line) => line.includes("document too large"))).toBe(true);
    });
});
