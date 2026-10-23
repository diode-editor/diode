import { describe, expect, it, vi } from "vitest";

import { syncSourceOf } from "../../../../../TestUtils/documentSyncSource.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { CancellationTokenSource, type ICancellationToken } from "../../../../base/common/cancellation.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { IFormattingRequest } from "../../../../editor/common/languages/iFormattingSource.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";

import { ExtensionHost } from "./extensionHost.ts";

// The channel is wired in-process: branches unreachable through a real fork (a document without
// sync, the shape of RPC params).

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

/** Requests are sent only for documents synced with the subprocess. */
const DOCUMENT = { uri: "file:///a.ts", languageId: "typescript", version: 3, text: "const a = 1;\n" };

const WIRE_EDIT = { range: { start: { line: 0, character: 5 }, end: { line: 0, character: 7 } }, text: " " };

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
    if (options.open !== false) host.didOpenTextDocument(syncSourceOf(DOCUMENT));
    return { host, peer };
}

describe("ExtensionHost — formatting by handle (in-process)", () => {
    it("the request carries the handle; range goes as a core range and is not invented without one", async () => {
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

    it("document not open in the subprocess: empty without RPC", async () => {
        const { host, peer } = makeHost({ open: false });
        const provide = vi.fn(() => Promise.resolve([WIRE_EDIT]));
        peer.handleRequest("languages.provideFormattingEdits", provide);

        expect(await host.provideFormattingEdits(0, requestOf())).toEqual([]);
        expect(provide).not.toHaveBeenCalled();
    });

    it("a document exactly at the sync threshold passes; above it, empty without RPC and a log entry", async () => {
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

    it("no request is sent after the subprocess stops", async () => {
        const { host, peer } = makeHost();
        const provide = vi.fn(() => Promise.resolve([WIRE_EDIT]));
        peer.handleRequest("languages.provideFormattingEdits", provide);

        await (host as unknown as { shutdownSubprocess(): Promise<void> }).shutdownSubprocess();

        expect(await host.provideFormattingEdits(0, requestOf())).toEqual([]);
        expect(provide).not.toHaveBeenCalled();
    });

    it("a too-large document without a logger yields the same [], no crash on warn", async () => {
        const { host, peer } = makeHost({ maxSyncedDocumentChars: DOCUMENT.text.length - 1 });
        const provide = vi.fn(() => Promise.resolve([WIRE_EDIT]));
        peer.handleRequest("languages.provideFormattingEdits", provide);

        expect(await host.provideFormattingEdits(0, requestOf())).toEqual([]);
        expect(provide).not.toHaveBeenCalled();
    });

    it("core cancellation reaches the subprocess token (provideFormattingEdits)", async () => {
        const { host, peer } = makeHost();
        let seen: ICancellationToken | null = null;
        peer.handleRequest("languages.provideFormattingEdits", (_params, token) => {
            seen = token;
            return new Promise(() => undefined);
        });

        const source = new CancellationTokenSource();
        const pending = host.provideFormattingEdits(0, requestOf(), source.token);
        await flushMicrotasks();
        expect(seen!.isCancellationRequested).toBe(false);

        source.cancel();
        await flushMicrotasks();
        expect(seen!.isCancellationRequested).toBe(true);
        void pending;
    });
});
