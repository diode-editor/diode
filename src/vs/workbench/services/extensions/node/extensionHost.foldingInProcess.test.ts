import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { CancellationTokenSource, type ICancellationToken } from "../../../../base/common/cancellation.ts";
import type { IFoldingRequest } from "../../../../editor/common/languages/iFoldingSource.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";

import { ExtensionHost } from "./extensionHost.ts";

/**
 * Folding по handle: субпроцесса нет, канал сшит in-process — так видно, что
 * вызовы прокси с одним запросом уходят одной пачкой (пересчёт фолдов идёт на
 * каждую правку, и запросы не должны множиться на число провайдеров), что
 * документ без синхронизации не спрашивается и что остановка субпроцесса
 * отрезает запросы.
 */

const NOOP_EDITOR_OPTIONS = {
    getActiveEditorOptions: () => null,
    setActiveEditorOptions: () => undefined,
    getActiveEditorFilePath: () => null,
    getActiveEditorMeta: () => ({ uri: null, languageId: null, isDirty: false }),
    onActiveEditorChanged: () => ({ dispose: () => undefined }),
    onActiveEditorSelectionChanged: () => ({ dispose: () => undefined }),
} as unknown as IEditorOptionsService;

const NOOP_COMMANDS = {
    execute: () => undefined,
    registerProxy: () => ({ dispose: () => undefined }),
} as unknown as ICommandService;

/** Документ, который тесты открывают субпроцессу: запросы ходят только по синхронизированным. */
const DOCUMENT = { uri: "file:///a.cs", languageId: "csharp", version: 3, text: "a\nb\nc\nd\n" };

function makeHost(open = true): { host: ExtensionHost; peer: RpcEndpoint } {
    const host = new ExtensionHost(NOOP_EDITOR_OPTIONS, NOOP_COMMANDS, {});
    const [a, b] = createInProcessChannelPair();
    const hostRpc = new RpcEndpoint(a);
    const peer = new RpcEndpoint(b);
    (host as unknown as { installHostHandlers(rpc: RpcEndpoint): void }).installHostHandlers(hostRpc);
    (host as unknown as { rpc: RpcEndpoint }).rpc = hostRpc;
    if (open) host.didOpenTextDocument(DOCUMENT);
    return { host, peer };
}

const REQUEST: IFoldingRequest = { uri: DOCUMENT.uri, languageId: "csharp", versionId: 3 };

describe("ExtensionHost — folding по handle (in-process)", () => {
    it("вызовы прокси с одним запросом — один RPC с пачкой handle; области — по своим", async () => {
        const { host, peer } = makeHost();
        const provide = vi.fn((_params: unknown) => Promise.resolve([[{ start: 0, end: 2 }], [{ start: 1, end: 3 }]]));
        peer.handleRequest("languages.provideFoldingRanges", provide);

        const [first, second] = await Promise.all([
            host.provideFoldingRanges(2, REQUEST),
            host.provideFoldingRanges(6, REQUEST),
        ]);

        expect(provide).toHaveBeenCalledTimes(1);
        expect(provide.mock.calls[0]?.[0]).toEqual({
            handles: [2, 6],
            uri: DOCUMENT.uri,
            languageId: "csharp",
            version: 3,
        });
        expect(first).toEqual([{ startLine: 0, endLine: 2, isCollapsed: false }]);
        expect(second).toEqual([{ startLine: 1, endLine: 3, isCollapsed: false }]);
    });

    it("документ не открыт субпроцессу — пусто без RPC", async () => {
        const { host, peer } = makeHost(false);
        const provide = vi.fn(() => Promise.resolve([[{ start: 0, end: 2 }]]));
        peer.handleRequest("languages.provideFoldingRanges", provide);

        expect(await host.provideFoldingRanges(0, REQUEST)).toEqual([]);
        expect(provide).not.toHaveBeenCalled();
    });

    it("после остановки субпроцесса запрос не уходит", async () => {
        const { host, peer } = makeHost();
        const provide = vi.fn(() => Promise.resolve([[{ start: 0, end: 2 }]]));
        peer.handleRequest("languages.provideFoldingRanges", provide);

        await (host as unknown as { shutdownSubprocess(): Promise<void> }).shutdownSubprocess();

        expect(await host.provideFoldingRanges(0, REQUEST)).toEqual([]);
        expect(provide).not.toHaveBeenCalled();
    });

    it("отмена ядра доезжает до токена субпроцесса (provideFoldingRanges)", async () => {
        const { host, peer } = makeHost();
        let seen: ICancellationToken | null = null;
        peer.handleRequest("languages.provideFoldingRanges", (_params, token) => {
            seen = token;
            return new Promise(() => undefined);
        });

        const source = new CancellationTokenSource();
        const pending = host.provideFoldingRanges(0, REQUEST, source.token);
        await flushMicrotasks();
        expect(seen!.isCancellationRequested).toBe(false);

        source.cancel();
        await flushMicrotasks();
        // Провайдер расширения узнаёт, что его ответ больше не нужен, и бросает работу.
        expect(seen!.isCancellationRequested).toBe(true);
        void pending;
    });
});
