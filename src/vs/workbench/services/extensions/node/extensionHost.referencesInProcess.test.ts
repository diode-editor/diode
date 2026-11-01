import { describe, expect, it, vi } from "vitest";

import { syncSourceOf } from "../../../../../TestUtils/documentSyncSource.ts";
import { flushMicrotasks, settle } from "../../../../../TestUtils/timing.ts";
import { CancellationTokenSource, type ICancellationToken } from "../../../../base/common/cancellation.ts";
import type { IReferenceRequest } from "../../../../editor/common/languages/iReferenceSource.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";

import { ExtensionHost } from "./extensionHost.ts";

// The channel is wired in-process: branches unreachable through a real fork (a document without
// sync, the default timeout).

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
    listCommandIds: () => [],
    registerProxy: () => ({ dispose: () => undefined }),
} as unknown as ICommandService;

/** Requests are sent only for documents synced with the subprocess. */
const DOCUMENT = { uri: "file:///a.ts", languageId: "typescript", version: 3, text: "const a = 1;\n" };

const REF = { uri: "file:///a.ts", range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } } };
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
        timeoutMs?: number;
        maxSyncedDocumentChars?: number;
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
    if (options.open !== false) host.didOpenTextDocument(syncSourceOf(DOCUMENT));
    return { host, peer };
}

describe("ExtensionHost — references request by handle (in-process)", () => {
    it("the request carries the provider handle", async () => {
        const { host, peer } = makeHost();
        const provide = vi.fn((_params: unknown) => Promise.resolve([REF]));
        peer.handleRequest("languages.provideReferences", provide);

        expect(await host.provideReferences(3, requestOf())).toEqual([CORE_REF]);
        expect(provide.mock.calls[0]?.[0]).toMatchObject({ handle: 3 });
    });

    it("the includeDeclaration context goes to the subprocess as is", async () => {
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

    it("document not open in the subprocess: empty without RPC", async () => {
        const { host, peer } = makeHost({ open: false });
        const provide = vi.fn(() => Promise.resolve([REF]));
        peer.handleRequest("languages.provideReferences", provide);

        expect(await host.provideReferences(0, requestOf())).toEqual([]);
        expect(provide).not.toHaveBeenCalled();
    });

    it("a document exactly at the sync threshold passes; above it, empty without RPC and a log entry", async () => {
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

    it("no request is sent after the subprocess stops", async () => {
        const { host, peer } = makeHost();
        const provide = vi.fn(() => Promise.resolve([REF]));
        peer.handleRequest("languages.provideReferences", provide);
        expect(await host.provideReferences(0, requestOf())).toEqual([CORE_REF]);

        await (host as unknown as { shutdownSubprocess(): Promise<void> }).shutdownSubprocess();

        expect(await host.provideReferences(0, requestOf())).toEqual([]);
        expect(provide).toHaveBeenCalledTimes(1);
    });

    it("definition by handle: no request is sent after the subprocess stops", async () => {
        const { host, peer } = makeHost();
        const provide = vi.fn(() => Promise.resolve([REF]));
        peer.handleRequest("languages.provideDefinition", provide);
        expect(await host.provideDefinition(0, requestOf())).toEqual([CORE_REF]);

        await (host as unknown as { shutdownSubprocess(): Promise<void> }).shutdownSubprocess();

        expect(await host.provideDefinition(0, requestOf())).toEqual([]);
        expect(provide).toHaveBeenCalledTimes(1);
    });

    it("implementation by handle: the handle reaches the subprocess, nothing is sent after it stops", async () => {
        const { host, peer } = makeHost();
        const provide = vi.fn((_params: unknown) => Promise.resolve([REF]));
        peer.handleRequest("languages.provideImplementation", provide);

        expect(await host.provideImplementation(7, requestOf())).toEqual([CORE_REF]);
        expect(provide.mock.calls[0]?.[0]).toMatchObject({ handle: 7, line: 0, character: 0, version: 3 });

        await (host as unknown as { shutdownSubprocess(): Promise<void> }).shutdownSubprocess();

        expect(await host.provideImplementation(7, requestOf())).toEqual([]);
        expect(provide).toHaveBeenCalledTimes(1);
    });

    it.each([
        ["languages.provideTypeDefinition", "provideTypeDefinition"],
        ["languages.provideDeclaration", "provideDeclaration"],
    ] as const)("%s by handle: the handle reaches the subprocess", async (method, call) => {
        const { host, peer } = makeHost();
        const provide = vi.fn((_params: unknown) => Promise.resolve([REF]));
        peer.handleRequest(method, provide);

        expect(await host[call](7, requestOf())).toEqual([CORE_REF]);
        expect(provide.mock.calls[0]?.[0]).toMatchObject({ handle: 7, line: 0, character: 0, version: 3 });
    });

    it.each([
        ["languages.provideTypeDefinition", "provideTypeDefinition"],
        ["languages.provideDeclaration", "provideDeclaration"],
    ] as const)("core cancellation reaches the subprocess token (%s)", async (method, call) => {
        const { host, peer } = makeHost();
        let seen: ICancellationToken | null = null;
        peer.handleRequest(method, (_params, token) => {
            seen = token;
            return new Promise(() => undefined);
        });

        const source = new CancellationTokenSource();
        const pending = host[call](0, requestOf(), source.token);
        await flushMicrotasks();
        expect(seen!.isCancellationRequested).toBe(false);

        source.cancel();
        await flushMicrotasks();
        expect(seen!.isCancellationRequested).toBe(true);
        void pending;
    });

    it("core cancellation reaches the subprocess token (provideImplementation)", async () => {
        const { host, peer } = makeHost();
        let seen: ICancellationToken | null = null;
        peer.handleRequest("languages.provideImplementation", (_params, token) => {
            seen = token;
            return new Promise(() => undefined);
        });

        const source = new CancellationTokenSource();
        const pending = host.provideImplementation(0, requestOf(), source.token);
        await flushMicrotasks();
        expect(seen!.isCancellationRequested).toBe(false);

        source.cancel();
        await flushMicrotasks();
        expect(seen!.isCancellationRequested).toBe(true);
        void pending;
    });

    it("default timeout is 5000 ms: project-wide reference search costs more than a single jump", async () => {
        const { host, peer } = makeHost();
        const hostRpc = (host as unknown as { rpc: RpcEndpoint }).rpc;
        const request = vi.spyOn(hostRpc, "request");
        peer.handleRequest("languages.provideReferences", () => []);
        // The deadline travels to the transport with the request instead of being awaited live: a real
        // wait costs seconds on every mutant in the mutation run.
        await host.provideReferences(0, requestOf());
        expect(request).toHaveBeenCalledWith("languages.provideReferences", expect.anything(), { timeoutMs: 5000 });
    });

    it("after the timeout the response is dropped and the subprocess request is cancelled", async () => {
        const debug = vi.fn();
        const { host, peer } = makeHost({ timeoutMs: 5, debug });
        let seen: ICancellationToken | undefined;
        peer.handleRequest("languages.provideReferences", async (_params, token) => {
            seen = token;
            await settle(200);
            return [REF];
        });

        expect(await host.provideReferences(0, requestOf())).toEqual([]);
        // An expired deadline is a normal outcome for a slow provider: debug, not warn.
        expect(debug).toHaveBeenCalledWith('request "languages.provideReferences" timed out after 5ms');
        await vi.waitFor(() => {
            expect(seen?.isCancellationRequested).toBe(true);
        });
    });

    it("core cancellation reaches the subprocess token (provideReferences)", async () => {
        const { host, peer } = makeHost();
        let seen: ICancellationToken | null = null;
        peer.handleRequest("languages.provideReferences", (_params, token) => {
            seen = token;
            return new Promise(() => undefined);
        });

        const source = new CancellationTokenSource();
        const pending = host.provideReferences(0, requestOf(), source.token);
        await flushMicrotasks();
        expect(seen!.isCancellationRequested).toBe(false);

        source.cancel();
        await flushMicrotasks();
        expect(seen!.isCancellationRequested).toBe(true);
        void pending;
    });

    it("core cancellation reaches the subprocess token (provideDefinition)", async () => {
        const { host, peer } = makeHost();
        let seen: ICancellationToken | null = null;
        peer.handleRequest("languages.provideDefinition", (_params, token) => {
            seen = token;
            return new Promise(() => undefined);
        });

        const source = new CancellationTokenSource();
        const pending = host.provideDefinition(0, requestOf(), source.token);
        await flushMicrotasks();
        expect(seen!.isCancellationRequested).toBe(false);

        source.cancel();
        await flushMicrotasks();
        expect(seen!.isCancellationRequested).toBe(true);
        void pending;
    });
});
