import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { CancellationTokenSource, type ICancellationToken } from "../../../../base/common/cancellation.ts";
import type { ICompletionRequest } from "../../../../editor/common/languages/iCompletionSource.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";

import { ExtensionHost } from "./extensionHost.ts";

/**
 * Completion по handle: субпроцесса нет, канал сшит in-process — так видно,
 * какие сообщения уходят (пачка handle на один запрос), что документ без
 * синхронизации не спрашивается и что остановка субпроцесса отрезает запросы (образец — `extensionHost.hoverInProcess.test.ts`).
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
const DOCUMENT = { uri: "file:///a.ts", languageId: "typescript", version: 3, text: "const a = 1;\n" };

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

const REQUEST: ICompletionRequest = {
    uri: DOCUMENT.uri,
    languageId: "typescript",
    versionId: 3,
    line: 0,
    character: 2,
};

describe("ExtensionHost — completion по handle (in-process)", () => {
    it("вызовы прокси с одним запросом уходят одним RPC с пачкой handle; ответы — по своим", async () => {
        const { host, peer } = makeHost();
        const provide = vi.fn((_params: unknown) =>
            Promise.resolve([
                { items: [{ label: "first", insertText: "first" }], isIncomplete: true },
                { items: [{ label: "second", insertText: "second" }], isIncomplete: false },
            ]),
        );
        peer.handleRequest("languages.provideCompletionItems", provide);

        const [first, second] = await Promise.all([
            host.provideCompletionItems(4, REQUEST),
            host.provideCompletionItems(9, REQUEST),
        ]);

        expect(provide).toHaveBeenCalledTimes(1);
        expect(provide.mock.calls[0]?.[0]).toEqual({
            handles: [4, 9],
            uri: DOCUMENT.uri,
            languageId: "typescript",
            version: 3,
            line: 0,
            character: 2,
        });
        expect(first).toEqual({ items: [{ label: "first", insertText: "first" }], isIncomplete: true });
        expect(second).toEqual({ items: [{ label: "second", insertText: "second" }], isIncomplete: false });
    });

    it("триггер запроса уходит в субпроцесс, только когда он есть", async () => {
        const { host, peer } = makeHost();
        const seen: unknown[] = [];
        peer.handleRequest("languages.provideCompletionItems", (params) => {
            seen.push(params);
            return Promise.resolve([]);
        });

        await host.provideCompletionItems(0, REQUEST);
        await host.provideCompletionItems(0, { ...REQUEST, triggerKind: 1, triggerCharacter: "." });

        expect(Object.keys(seen[0] as object).sort()).toEqual([
            "character",
            "handles",
            "languageId",
            "line",
            "uri",
            "version",
        ]);
        expect(seen[1]).toMatchObject({ triggerKind: 1, triggerCharacter: "." });
    });

    it("документ не открыт субпроцессу — пусто без RPC", async () => {
        const { host, peer } = makeHost(false);
        const provide = vi.fn(() =>
            Promise.resolve([{ items: [{ label: "a", insertText: "a" }], isIncomplete: false }]),
        );
        peer.handleRequest("languages.provideCompletionItems", provide);

        expect(await host.provideCompletionItems(0, REQUEST)).toEqual({ items: [], isIncomplete: false });
        expect(provide).not.toHaveBeenCalled();
    });

    it("после остановки субпроцесса completion и resolve не уходят", async () => {
        const { host, peer } = makeHost();
        const provide = vi.fn(() => Promise.resolve([]));
        const resolve = vi.fn(() => Promise.resolve({ detail: "d" }));
        peer.handleRequest("languages.provideCompletionItems", provide);
        peer.handleRequest("languages.resolveCompletionItem", resolve);
        expect(await host.resolveCompletionItem("1.0")).toEqual({ detail: "d" });

        await (host as unknown as { shutdownSubprocess(): Promise<void> }).shutdownSubprocess();

        expect(await host.provideCompletionItems(0, REQUEST)).toEqual({ items: [], isIncomplete: false });
        expect(await host.resolveCompletionItem("1.0")).toBeNull();
        expect(provide).not.toHaveBeenCalled();
        expect(resolve).toHaveBeenCalledTimes(1);
    });

    it("отмена ядра доезжает до токена субпроцесса (provideCompletionItems)", async () => {
        const { host, peer } = makeHost();
        let seen: ICancellationToken | null = null;
        peer.handleRequest("languages.provideCompletionItems", (_params, token) => {
            seen = token;
            return new Promise(() => undefined);
        });

        const source = new CancellationTokenSource();
        const pending = host.provideCompletionItems(0, REQUEST, source.token);
        await flushMicrotasks();
        expect(seen!.isCancellationRequested).toBe(false);

        source.cancel();
        await flushMicrotasks();
        // Провайдер расширения узнаёт, что его ответ больше не нужен, и бросает работу.
        expect(seen!.isCancellationRequested).toBe(true);
        void pending;
    });
});
