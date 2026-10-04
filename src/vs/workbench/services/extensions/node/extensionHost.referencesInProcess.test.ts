import { describe, expect, it, vi } from "vitest";

import { settle } from "../../../../../TestUtils/timing.ts";
import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import type { IReferenceRequest } from "../../../../editor/common/languages/iReferenceSource.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";

import { ExtensionHost } from "./extensionHost.ts";

/**
 * References-запрос по handle: субпроцесса нет, канал сшит in-process — так
 * проверяются ветки, недостижимые через настоящий fork (документ без
 * синхронизации, дефолтный таймаут).
 * Образец — `extensionHost.hoverInProcess.test.ts`.
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

const REF = { uri: "file:///a.ts", range: { startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 3 } };
const CORE_REF = { uri: "file:///a.ts", range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } } };

function requestOf(): IReferenceRequest {
    return {
        uri: DOCUMENT.uri,
        languageId: "typescript",
        versionId: 3,
        line: 0,
        character: 0,
        includeDeclaration: true,
    };
}

function makeHost(
    options: {
        warn?: ILogger["warn"];
        debug?: ILogger["debug"];
        /** Срок ответа `languages.provideReferences`, мс (`requestTimeouts`). */
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
            : { requestTimeouts: { "languages.provideReferences": options.timeoutMs } }),
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

describe("ExtensionHost — references-запрос по handle (in-process)", () => {
    it("запрос несёт handle провайдера", async () => {
        const { host, peer } = makeHost();
        const provide = vi.fn((_params: unknown) => Promise.resolve([REF]));
        peer.handleRequest("languages.provideReferences", provide);

        expect(await host.provideReferences(3, requestOf())).toEqual([CORE_REF]);
        expect(provide.mock.calls[0]?.[0]).toMatchObject({ handle: 3 });
    });

    it("контекст includeDeclaration уходит в субпроцесс как есть", async () => {
        const { host, peer } = makeHost();
        const seen: unknown[] = [];
        peer.handleRequest("languages.provideReferences", (params) => {
            seen.push(params);
            return Promise.resolve([]);
        });

        await host.provideReferences(0, { ...requestOf(), includeDeclaration: false });

        expect(seen).toEqual([
            {
                handle: 0,
                uri: "file:///a.ts",
                languageId: "typescript",
                version: 3,
                line: 0,
                character: 0,
                includeDeclaration: false,
            },
        ]);
    });

    it("документ не открыт субпроцессу — пусто без RPC", async () => {
        const { host, peer } = makeHost({ open: false });
        const provide = vi.fn(() => Promise.resolve([REF]));
        peer.handleRequest("languages.provideReferences", provide);

        expect(await host.provideReferences(0, requestOf())).toEqual([]);
        expect(provide).not.toHaveBeenCalled();
    });

    it("документ ровно в порог синхронизации проходит, больше порога — пусто без RPC и запись в лог", async () => {
        const length = DOCUMENT.text.length;
        const atLimit = makeHost({ maxSyncedDocumentChars: length });
        const provide = vi.fn(() => Promise.resolve([REF]));
        atLimit.peer.handleRequest("languages.provideReferences", provide);
        expect(await atLimit.host.provideReferences(0, requestOf())).toEqual([CORE_REF]);
        expect(provide).toHaveBeenCalledTimes(1);

        const warn = vi.fn();
        const over = makeHost({ warn, maxSyncedDocumentChars: length - 1 });
        over.peer.handleRequest("languages.provideReferences", provide);
        expect(await over.host.provideReferences(0, requestOf())).toEqual([]);
        expect(provide).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith("skipping document sync: document too large", {
            uri: "file:///a.ts",
            length,
        });
    });

    it("после остановки субпроцесса запрос не уходит", async () => {
        const { host, peer } = makeHost();
        const provide = vi.fn(() => Promise.resolve([REF]));
        peer.handleRequest("languages.provideReferences", provide);
        expect(await host.provideReferences(0, requestOf())).toEqual([CORE_REF]);

        await (host as unknown as { shutdownSubprocess(): Promise<void> }).shutdownSubprocess();

        expect(await host.provideReferences(0, requestOf())).toEqual([]);
        expect(provide).toHaveBeenCalledTimes(1);
    });

    it("definition по handle: после остановки субпроцесса запрос не уходит", async () => {
        const { host, peer } = makeHost();
        const provide = vi.fn(() => Promise.resolve([REF]));
        peer.handleRequest("languages.provideDefinition", provide);
        expect(await host.provideDefinition(0, requestOf())).toEqual([CORE_REF]);

        await (host as unknown as { shutdownSubprocess(): Promise<void> }).shutdownSubprocess();

        expect(await host.provideDefinition(0, requestOf())).toEqual([]);
        expect(provide).toHaveBeenCalledTimes(1);
    });

    it("дефолт таймаута — 5000 мс: поиск ссылок по проекту дороже одиночного перехода", async () => {
        const { host, peer } = makeHost();
        const hostRpc = (host as unknown as { rpc: RpcEndpoint }).rpc;
        const request = vi.spyOn(hostRpc, "request");
        peer.handleRequest("languages.provideReferences", () => []);
        // Срок уезжает транспорту с запросом, а не ждётся вживую: реальное
        // ожидание в мутационном прогоне стоит секунды на каждом мутанте.
        await host.provideReferences(0, requestOf());
        expect(request).toHaveBeenCalledWith("languages.provideReferences", expect.anything(), { timeoutMs: 5000 });
    });

    it("по истечении таймаута ответ отбрасывается, а запрос у субпроцесса отменяется", async () => {
        const debug = vi.fn();
        const { host, peer } = makeHost({ timeoutMs: 5, debug });
        let seen: ICancellationToken | undefined;
        peer.handleRequest("languages.provideReferences", async (_params, token) => {
            seen = token;
            await settle(200);
            return [REF];
        });

        expect(await host.provideReferences(0, requestOf())).toEqual([]);
        // Истёкший срок — штатный исход медленного провайдера: debug, не warn.
        expect(debug).toHaveBeenCalledWith('request "languages.provideReferences" timed out after 5ms');
        // Провайдер узнаёт, что ответа больше не ждут (`$/cancelRequest`).
        await vi.waitFor(() => {
            expect(seen?.isCancellationRequested).toBe(true);
        });
    });
});
