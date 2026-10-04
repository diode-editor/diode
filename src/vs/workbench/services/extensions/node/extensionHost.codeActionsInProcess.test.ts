import { describe, expect, it, vi } from "vitest";

import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ICodeActionRequest } from "../../../../editor/common/languages/iCodeActionSource.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";

import { ExtensionHost } from "./extensionHost.ts";

/**
 * Запросы code actions по handle: субпроцесса нет, канал сшит in-process — так
 * проверяются ветки, недостижимые через настоящий fork (документ без
 * синхронизации, форма параметров, остановка субпроцесса). Образец —
 * `extensionHost.formattingInProcess.test.ts`.
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
const DOCUMENT = { uri: "file:///a.py", languageId: "python", version: 3, text: "import os\n" };

const WIRE_ACTION = { id: "1.0", title: "Fix", kind: "quickfix" };

function requestOf(patch: Partial<ICodeActionRequest> = {}): ICodeActionRequest {
    return {
        uri: DOCUMENT.uri,
        languageId: "python",
        versionId: 3,
        range: createRange(0, 0, 0, 1),
        ...patch,
    };
}

function makeHost(
    options: {
        warn?: ILogger["warn"];
        maxSyncedDocumentChars?: number;
        /** Открыть {@link DOCUMENT} субпроцессу (по умолчанию — да). */
        open?: boolean;
    } = {},
): { host: ExtensionHost; peer: RpcEndpoint } {
    const logger =
        options.warn === undefined
            ? undefined
            : ({ warn: options.warn, info: () => undefined, error: () => undefined } as unknown as ILogger);
    const host = new ExtensionHost(NOOP_EDITOR_OPTIONS, NOOP_COMMANDS, {
        ...(logger === undefined ? {} : { logger }),
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

describe("ExtensionHost — code actions по handle (in-process)", () => {
    it("provide несёт handle, apply — id действия; после остановки субпроцесса оба не уходят", async () => {
        const { host, peer } = makeHost();
        const provide = vi.fn((_params: unknown) => Promise.resolve([WIRE_ACTION]));
        const apply = vi.fn(() => Promise.resolve(true));
        peer.handleRequest("languages.provideCodeActions", provide);
        peer.handleRequest("languages.applyCodeAction", apply);

        expect(await host.provideCodeActions(3, requestOf())).toEqual([WIRE_ACTION]);
        expect(provide.mock.calls[0]?.[0]).toMatchObject({ handle: 3 });
        expect(await host.applyCodeAction("1.0")).toBe(true);
        // Второй аргумент любого хендлера — токен отмены запроса (RpcEndpoint
        // выдаёт его всем методам; code actions его пока не используют).
        expect(apply).toHaveBeenCalledExactlyOnceWith(
            { id: "1.0" },
            expect.objectContaining({ isCancellationRequested: false }),
        );

        await (host as unknown as { shutdownSubprocess(): Promise<void> }).shutdownSubprocess();

        expect(await host.provideCodeActions(3, requestOf())).toEqual([]);
        expect(await host.applyCodeAction("1.0")).toBe(false);
        expect(provide).toHaveBeenCalledTimes(1);
        expect(apply).toHaveBeenCalledTimes(1);
    });

    it("параметры provide едут как есть; only не выдумывается без запроса", async () => {
        const { host, peer } = makeHost();
        const seen: unknown[] = [];
        peer.handleRequest("languages.provideCodeActions", (params) => {
            seen.push(params);
            return Promise.resolve(null);
        });

        // `null` от субпроцесса (старая форма «провайдера нет») читается как «действий нет».
        expect(await host.provideCodeActions(0, requestOf({ range: createRange(1, 2, 3, 4) }))).toEqual([]);
        await host.provideCodeActions(0, requestOf({ only: "source.organizeImports" }));

        expect(seen).toEqual([
            {
                handle: 0,
                uri: "file:///a.py",
                languageId: "python",
                version: 3,
                range: { startLine: 1, startCharacter: 2, endLine: 3, endCharacter: 4 },
            },
            {
                handle: 0,
                uri: "file:///a.py",
                languageId: "python",
                version: 3,
                range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 1 },
                only: "source.organizeImports",
            },
        ]);
    });

    it("документ не открыт субпроцессу — пусто без RPC", async () => {
        const { host, peer } = makeHost({ open: false });
        const provide = vi.fn(() => Promise.resolve([WIRE_ACTION]));
        peer.handleRequest("languages.provideCodeActions", provide);

        expect(await host.provideCodeActions(0, requestOf())).toEqual([]);
        expect(provide).not.toHaveBeenCalled();
    });

    it("документ ровно в порог синхронизации проходит, больше порога — пусто без RPC и запись в лог", async () => {
        const length = DOCUMENT.text.length;
        const atLimit = makeHost({ maxSyncedDocumentChars: length });
        const provide = vi.fn(() => Promise.resolve([WIRE_ACTION]));
        atLimit.peer.handleRequest("languages.provideCodeActions", provide);
        expect(await atLimit.host.provideCodeActions(0, requestOf())).toEqual([WIRE_ACTION]);
        expect(provide).toHaveBeenCalledTimes(1);

        const warn = vi.fn();
        const over = makeHost({ warn, maxSyncedDocumentChars: length - 1 });
        over.peer.handleRequest("languages.provideCodeActions", provide);
        expect(await over.host.provideCodeActions(0, requestOf())).toEqual([]);
        expect(provide).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith("skipping document sync: document too large", { uri: DOCUMENT.uri, length });
    });
});
