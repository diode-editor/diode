import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks, settle } from "../../../../../TestUtils/timing.ts";
import { CancellationTokenSource, type ICancellationToken } from "../../../../base/common/cancellation.ts";
import type { IHoverRequest } from "../../../../editor/common/languages/iHoverSource.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";

import { ExtensionHost } from "./extensionHost.ts";

/**
 * Регистрации языковых провайдеров и hover-запрос по handle: субпроцесса нет,
 * канал сшит in-process — так проверяются ветки, недостижимые через настоящий
 * fork (чужая форма нотификации, документ без синхронизации, дефолтный таймаут). Образец —
 * `extensionHost.completionInProcess.test.ts`.
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
const REQUEST: IHoverRequest = { uri: DOCUMENT.uri, languageId: "typescript", versionId: 3, line: 0, character: 0 };

function makeHost(
    options: {
        warn?: ILogger["warn"];
        debug?: ILogger["debug"];
        /** Срок ответа `languages.provideHover`, мс (`requestTimeouts`). */
        timeoutMs?: number;
        maxSyncedDocumentChars?: number;
        /** Открыть {@link DOCUMENT} субпроцессу (по умолчанию — да). */
        open?: boolean;
    } = {},
): {
    host: ExtensionHost;
    peer: RpcEndpoint;
} {
    const logger =
        options.warn === undefined && options.debug === undefined
            ? undefined
            : ({
                  warn: options.warn ?? (() => undefined),
                  debug: options.debug ?? (() => undefined),
                  info: () => undefined,
                  error: () => undefined,
              } as unknown as ILogger);
    const host = new ExtensionHost(NOOP_EDITOR_OPTIONS, NOOP_COMMANDS, {
        ...(logger === undefined ? {} : { logger }),
        ...(options.timeoutMs === undefined
            ? {}
            : { requestTimeouts: { "languages.provideHover": options.timeoutMs } }),
        ...(options.maxSyncedDocumentChars === undefined
            ? {}
            : { maxSyncedDocumentChars: options.maxSyncedDocumentChars }),
    });
    const [a, b] = createInProcessChannelPair();
    const hostRpc = new RpcEndpoint(a);
    const peer = new RpcEndpoint(b);
    (host as unknown as { installHostHandlers(rpc: RpcEndpoint): void }).installHostHandlers(hostRpc);
    (host as unknown as { rpc: RpcEndpoint }).rpc = hostRpc;
    if (options.open !== false) host.didOpenTextDocument(DOCUMENT);
    return { host, peer };
}

const HOVER_REGISTRATION = { handle: 7, kind: "hover", selector: [{ language: "typescript" }] };

describe("ExtensionHost — регистрации языковых провайдеров (in-process)", () => {
    it("languages.register/unregister ведут список провайдеров и будят слушателей", async () => {
        const { host, peer } = makeHost();
        const changed = vi.fn();
        host.onLanguageProvidersChanged(changed);
        expect(host.getLanguageProviders()).toEqual([]);

        peer.notify("languages.register", HOVER_REGISTRATION);
        await flushMicrotasks();
        expect(host.getLanguageProviders()).toEqual([HOVER_REGISTRATION]);
        expect(changed).toHaveBeenCalledTimes(1);

        peer.notify("languages.unregister", { handle: 7 });
        await flushMicrotasks();
        expect(host.getLanguageProviders()).toEqual([]);
        expect(changed).toHaveBeenCalledTimes(2);
    });

    it("чужая форма регистрации и снятие неизвестного handle игнорируются без события", async () => {
        const { host, peer } = makeHost();
        const changed = vi.fn();
        host.onLanguageProvidersChanged(changed);

        peer.notify("languages.register", { handle: 1, kind: "teleport", selector: [] });
        peer.notify("languages.unregister", { handle: 99 });
        peer.notify("languages.unregister", { handle: "1" });
        await flushMicrotasks();

        expect(host.getLanguageProviders()).toEqual([]);
        expect(changed).not.toHaveBeenCalled();
    });

    it("отписка снимает только своего слушателя", async () => {
        const { host, peer } = makeHost();
        const kept = vi.fn();
        const removed = vi.fn();
        // Снимаемый — первым: его индекс 0 тоже должен вычищаться.
        const sub = host.onLanguageProvidersChanged(removed);
        host.onLanguageProvidersChanged(kept);
        sub.dispose();
        sub.dispose();

        peer.notify("languages.register", HOVER_REGISTRATION);
        await flushMicrotasks();

        expect(kept).toHaveBeenCalledTimes(1);
        expect(removed).not.toHaveBeenCalled();
    });

    it("остановка субпроцесса снимает все регистрации одним событием", async () => {
        const { host, peer } = makeHost();
        peer.notify("languages.register", HOVER_REGISTRATION);
        peer.notify("languages.register", { ...HOVER_REGISTRATION, handle: 8 });
        await flushMicrotasks();
        const changed = vi.fn();
        host.onLanguageProvidersChanged(changed);

        await (host as unknown as { shutdownSubprocess(): Promise<void> }).shutdownSubprocess();

        expect(host.getLanguageProviders()).toEqual([]);
        expect(changed).toHaveBeenCalledTimes(1);
    });

    it("остановка без регистраций событий не порождает", async () => {
        const { host } = makeHost();
        const changed = vi.fn();
        host.onLanguageProvidersChanged(changed);

        await (host as unknown as { shutdownSubprocess(): Promise<void> }).shutdownSubprocess();

        expect(changed).not.toHaveBeenCalled();
    });
});

describe("ExtensionHost — hover-запрос по handle (in-process)", () => {
    it("запрос несёт handle провайдера и версию документа, без текста", async () => {
        const { host, peer } = makeHost();
        const provide = vi.fn((_params: unknown) => Promise.resolve({ contents: ["const a: number"] }));
        peer.handleRequest("languages.provideHover", provide);

        expect(await host.provideHover(7, REQUEST)).toEqual({ contents: ["const a: number"] });
        expect(provide.mock.calls[0]?.[0]).toEqual({
            handle: 7,
            uri: "file:///a.ts",
            languageId: "typescript",
            version: 3,
            line: 0,
            character: 0,
        });
    });

    it("документ не открыт субпроцессу — пусто без RPC", async () => {
        const { host, peer } = makeHost({ open: false });
        const provide = vi.fn(() => Promise.resolve({ contents: ["ok"] }));
        peer.handleRequest("languages.provideHover", provide);

        expect(await host.provideHover(1, REQUEST)).toBeUndefined();
        expect(provide).not.toHaveBeenCalled();
    });

    it("документ ровно в порог синхронизации проходит, больше порога — пусто без RPC и запись в лог", async () => {
        const length = DOCUMENT.text.length;
        const atLimit = makeHost({ maxSyncedDocumentChars: length });
        const provide = vi.fn(() => Promise.resolve({ contents: ["ok"] }));
        atLimit.peer.handleRequest("languages.provideHover", provide);
        expect(await atLimit.host.provideHover(1, REQUEST)).toEqual({ contents: ["ok"] });
        expect(provide).toHaveBeenCalledTimes(1);

        const warn = vi.fn();
        const over = makeHost({ warn, maxSyncedDocumentChars: length - 1 });
        over.peer.handleRequest("languages.provideHover", provide);
        expect(await over.host.provideHover(1, REQUEST)).toBeUndefined();
        expect(provide).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith("skipping document sync: document too large", {
            uri: "file:///a.ts",
            length,
        });
    });

    it("после остановки субпроцесса запрос не уходит", async () => {
        const { host, peer } = makeHost();
        const provide = vi.fn(() => Promise.resolve({ contents: ["жив"] }));
        peer.handleRequest("languages.provideHover", provide);
        expect(await host.provideHover(1, REQUEST)).toEqual({ contents: ["жив"] });

        await (host as unknown as { shutdownSubprocess(): Promise<void> }).shutdownSubprocess();

        expect(await host.provideHover(1, REQUEST)).toBeUndefined();
        expect(provide).toHaveBeenCalledTimes(1);
    });

    it("дефолт таймаута — 5000 мс, как у definition (холодный сервер индексирует секундами)", async () => {
        const { host, peer } = makeHost();
        const hostRpc = (host as unknown as { rpc: RpcEndpoint }).rpc;
        const request = vi.spyOn(hostRpc, "request");
        peer.handleRequest("languages.provideHover", () => null);
        // Срок уезжает транспорту с запросом, а не ждётся вживую: реальное
        // ожидание в мутационном прогоне стоит секунды на каждом мутанте.
        await host.provideHover(1, REQUEST);
        expect(request).toHaveBeenCalledWith("languages.provideHover", expect.anything(), { timeoutMs: 5000 });
    });

    it("по истечении таймаута ответ отбрасывается, а запрос у субпроцесса отменяется", async () => {
        const debug = vi.fn();
        const { host, peer } = makeHost({ timeoutMs: 5, debug });
        let seen: ICancellationToken | undefined;
        peer.handleRequest("languages.provideHover", async (_params, token) => {
            seen = token;
            await settle(200);
            return { contents: ["опоздал"] };
        });

        expect(await host.provideHover(1, REQUEST)).toBeUndefined();
        // Истёкший срок — штатный исход медленного провайдера: debug, не warn.
        expect(debug).toHaveBeenCalledWith('request "languages.provideHover" timed out after 5ms');
        // Провайдер узнаёт, что ответа больше не ждут (`$/cancelRequest`).
        await vi.waitFor(() => {
            expect(seen?.isCancellationRequested).toBe(true);
        });
    });

    it("отмена ядра доезжает до токена субпроцесса (provideHover)", async () => {
        const { host, peer } = makeHost();
        let seen: ICancellationToken | null = null;
        peer.handleRequest("languages.provideHover", (_params, token) => {
            seen = token;
            return new Promise(() => undefined);
        });

        const source = new CancellationTokenSource();
        const pending = host.provideHover(7, REQUEST, source.token);
        await flushMicrotasks();
        expect(seen!.isCancellationRequested).toBe(false);

        source.cancel();
        await flushMicrotasks();
        // Провайдер расширения узнаёт, что его ответ больше не нужен, и бросает работу.
        expect(seen!.isCancellationRequested).toBe(true);
        void pending;
    });
});
