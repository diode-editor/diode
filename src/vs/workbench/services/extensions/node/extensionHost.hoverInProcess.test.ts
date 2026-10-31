import { describe, expect, it, vi } from "vitest";

import { syncSourceOf } from "../../../../../TestUtils/documentSyncSource.ts";
import { flushMicrotasks, settle } from "../../../../../TestUtils/timing.ts";
import { CancellationTokenSource, type ICancellationToken } from "../../../../base/common/cancellation.ts";
import type { IHoverRequest } from "../../../../editor/common/languages/iHoverSource.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";

import { ExtensionHost } from "./extensionHost.ts";

// The channel is wired in-process: branches unreachable through a real fork (a foreign
// notification shape, a document without sync, the default timeout).

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
const REQUEST: IHoverRequest = { uri: DOCUMENT.uri, languageId: "typescript", versionId: 3, line: 0, character: 0 };

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
    if (options.open !== false) host.didOpenTextDocument(syncSourceOf(DOCUMENT));
    return { host, peer };
}

const HOVER_REGISTRATION = { handle: 7, kind: "hover", selector: [{ language: "typescript" }] };

describe("ExtensionHost — language provider registrations (in-process)", () => {
    it("languages.register/unregister maintain the provider list and notify listeners", async () => {
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

    it("a foreign registration shape and unregistering an unknown handle are ignored without an event", async () => {
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

    it("unsubscribing removes only its own listener", async () => {
        const { host, peer } = makeHost();
        const kept = vi.fn();
        const removed = vi.fn();
        // The removed one goes first: its index 0 must be cleaned up too.
        const sub = host.onLanguageProvidersChanged(removed);
        host.onLanguageProvidersChanged(kept);
        sub.dispose();
        sub.dispose();

        peer.notify("languages.register", HOVER_REGISTRATION);
        await flushMicrotasks();

        expect(kept).toHaveBeenCalledTimes(1);
        expect(removed).not.toHaveBeenCalled();
    });

    it("stopping the subprocess removes all registrations in one event", async () => {
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

    it("stopping without registrations fires no events", async () => {
        const { host } = makeHost();
        const changed = vi.fn();
        host.onLanguageProvidersChanged(changed);

        await (host as unknown as { shutdownSubprocess(): Promise<void> }).shutdownSubprocess();

        expect(changed).not.toHaveBeenCalled();
    });
});

describe("ExtensionHost — hover request by handle (in-process)", () => {
    it("the request carries the provider handle and the document version, without text", async () => {
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

    it("document not open in the subprocess: empty without RPC", async () => {
        const { host, peer } = makeHost({ open: false });
        const provide = vi.fn(() => Promise.resolve({ contents: ["ok"] }));
        peer.handleRequest("languages.provideHover", provide);

        expect(await host.provideHover(1, REQUEST)).toBeUndefined();
        expect(provide).not.toHaveBeenCalled();
    });

    it("a document exactly at the sync threshold passes; above it, empty without RPC and a log entry", async () => {
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

    it("no request is sent after the subprocess stops", async () => {
        const { host, peer } = makeHost();
        const provide = vi.fn(() => Promise.resolve({ contents: ["alive"] }));
        peer.handleRequest("languages.provideHover", provide);
        expect(await host.provideHover(1, REQUEST)).toEqual({ contents: ["alive"] });

        await (host as unknown as { shutdownSubprocess(): Promise<void> }).shutdownSubprocess();

        expect(await host.provideHover(1, REQUEST)).toBeUndefined();
        expect(provide).toHaveBeenCalledTimes(1);
    });

    it("default timeout is 5000 ms, as for definition (a cold server indexes for seconds)", async () => {
        const { host, peer } = makeHost();
        const hostRpc = (host as unknown as { rpc: RpcEndpoint }).rpc;
        const request = vi.spyOn(hostRpc, "request");
        peer.handleRequest("languages.provideHover", () => null);
        // The deadline goes to the transport with the request instead of being awaited live: a real
        // wait costs seconds per mutant in a mutation run.
        await host.provideHover(1, REQUEST);
        expect(request).toHaveBeenCalledWith("languages.provideHover", expect.anything(), { timeoutMs: 5000 });
    });

    it("after the timeout the response is dropped and the subprocess request is cancelled", async () => {
        const debug = vi.fn();
        const { host, peer } = makeHost({ timeoutMs: 5, debug });
        let seen: ICancellationToken | undefined;
        peer.handleRequest("languages.provideHover", async (_params, token) => {
            seen = token;
            await settle(200);
            return { contents: ["late"] };
        });

        expect(await host.provideHover(1, REQUEST)).toBeUndefined();
        // An expired deadline is a normal outcome for a slow provider: debug, not warn.
        expect(debug).toHaveBeenCalledWith('request "languages.provideHover" timed out after 5ms');
        await vi.waitFor(() => {
            expect(seen?.isCancellationRequested).toBe(true);
        });
    });

    it("core cancellation reaches the subprocess token (provideHover)", async () => {
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
        expect(seen!.isCancellationRequested).toBe(true);
        void pending;
    });
});
