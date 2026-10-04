import { describe, expect, it, vi } from "vitest";

import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { IFormattingRequest } from "../../../../editor/common/languages/iFormattingSource.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";

import { ExtensionHost } from "./extensionHost.ts";

/**
 * Запрос форматирования по handle: субпроцесса нет, канал сшит in-process —
 * так проверяются ветки, недостижимые через настоящий fork (документ без
 * синхронизации, форма параметров RPC). Образец —
 * `extensionHost.signatureHelpInProcess.test.ts`.
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

const WIRE_EDIT = { range: { startLine: 0, startCharacter: 5, endLine: 0, endCharacter: 7 }, text: " " };

function requestOf(patch: Partial<IFormattingRequest> = {}): IFormattingRequest {
    return {
        uri: DOCUMENT.uri,
        languageId: "typescript",
        versionId: 3,
        tabSize: 2,
        insertSpaces: true,
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

describe("ExtensionHost — форматирование по handle (in-process)", () => {
    it("запрос несёт handle; range едет core-диапазоном и не выдумывается без него", async () => {
        const { host, peer } = makeHost();
        const seen: unknown[] = [];
        peer.handleRequest("languages.provideFormattingEdits", (params) => {
            seen.push(params);
            return Promise.resolve([WIRE_EDIT]);
        });

        expect(await host.provideFormattingEdits(5, requestOf())).toEqual([
            { range: { start: { line: 0, character: 5 }, end: { line: 0, character: 7 } }, text: " " },
        ]);
        await host.provideFormattingEdits(6, requestOf({ range: createRange(1, 2, 3, 4) }));

        expect(seen).toEqual([
            { handle: 5, uri: "file:///a.ts", languageId: "typescript", version: 3, tabSize: 2, insertSpaces: true },
            {
                handle: 6,
                uri: "file:///a.ts",
                languageId: "typescript",
                version: 3,
                tabSize: 2,
                insertSpaces: true,
                range: { start: { line: 1, character: 2 }, end: { line: 3, character: 4 } },
            },
        ]);
    });

    it("документ не открыт субпроцессу — пусто без RPC", async () => {
        const { host, peer } = makeHost({ open: false });
        const provide = vi.fn(() => Promise.resolve([WIRE_EDIT]));
        peer.handleRequest("languages.provideFormattingEdits", provide);

        expect(await host.provideFormattingEdits(0, requestOf())).toEqual([]);
        expect(provide).not.toHaveBeenCalled();
    });

    it("документ ровно в порог синхронизации проходит, больше порога — пусто без RPC и запись в лог", async () => {
        const length = DOCUMENT.text.length;
        const atLimit = makeHost({ maxSyncedDocumentChars: length });
        const provide = vi.fn(() => Promise.resolve([WIRE_EDIT]));
        atLimit.peer.handleRequest("languages.provideFormattingEdits", provide);
        expect(await atLimit.host.provideFormattingEdits(0, requestOf())).toHaveLength(1);
        expect(provide).toHaveBeenCalledTimes(1);

        const warn = vi.fn();
        const over = makeHost({ warn, maxSyncedDocumentChars: length - 1 });
        over.peer.handleRequest("languages.provideFormattingEdits", provide);
        expect(await over.host.provideFormattingEdits(0, requestOf())).toEqual([]);
        expect(provide).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith("skipping document sync: document too large", {
            uri: "file:///a.ts",
            length,
        });
    });

    it("после остановки субпроцесса запрос не уходит", async () => {
        const { host, peer } = makeHost();
        const provide = vi.fn(() => Promise.resolve([WIRE_EDIT]));
        peer.handleRequest("languages.provideFormattingEdits", provide);

        await (host as unknown as { shutdownSubprocess(): Promise<void> }).shutdownSubprocess();

        expect(await host.provideFormattingEdits(0, requestOf())).toEqual([]);
        expect(provide).not.toHaveBeenCalled();
    });

    it("слишком большой документ без логгера — тот же [], без падения на warn", async () => {
        const { host, peer } = makeHost({ maxSyncedDocumentChars: DOCUMENT.text.length - 1 });
        const provide = vi.fn(() => Promise.resolve([WIRE_EDIT]));
        peer.handleRequest("languages.provideFormattingEdits", provide);

        expect(await host.provideFormattingEdits(0, requestOf())).toEqual([]);
        expect(provide).not.toHaveBeenCalled();
    });
});
