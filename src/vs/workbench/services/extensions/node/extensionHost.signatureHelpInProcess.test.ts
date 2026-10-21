import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks, settle } from "../../../../../TestUtils/timing.ts";
import { CancellationTokenSource, type ICancellationToken } from "../../../../base/common/cancellation.ts";
import type { ISignatureHelpRequest } from "../../../../editor/common/languages/iSignatureHelpSource.ts";
import { SignatureHelpTriggerKind } from "../../../../editor/common/languages/iSignatureHelpSource.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";

import { ExtensionHost } from "./extensionHost.ts";

// The channel is wired in-process: branches unreachable through a real fork (a document without
// sync, the default timeout, trigger characters in the registration metadata).

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

const HELP = {
    signatures: [{ label: "greet(name: string): void", parameters: [{ label: "name: string" }] }],
    activeSignature: 0,
    activeParameter: 0,
};

function requestOf(patch: Partial<ISignatureHelpRequest> = {}): ISignatureHelpRequest {
    return {
        uri: DOCUMENT.uri,
        languageId: "typescript",
        versionId: 3,
        line: 0,
        character: 6,
        triggerKind: SignatureHelpTriggerKind.Invoke,
        isRetrigger: false,
        ...patch,
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
            : { requestTimeouts: { "languages.provideSignatureHelp": options.timeoutMs } }),
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

describe("ExtensionHost — signature help by handle (in-process)", () => {
    it("the LSP context goes to the subprocess as is, empty fields are not invented", async () => {
        const { host, peer } = makeHost();
        const seen: unknown[] = [];
        peer.handleRequest("languages.provideSignatureHelp", (params) => {
            seen.push(params);
            return Promise.resolve(null);
        });

        await host.provideSignatureHelp(0, requestOf());
        await host.provideSignatureHelp(
            0,
            requestOf({
                triggerKind: SignatureHelpTriggerKind.TriggerCharacter,
                triggerCharacter: ",",
                isRetrigger: true,
                activeSignatureHelp: HELP,
            }),
        );

        expect(seen[0]).toEqual({
            handle: 0,
            uri: "file:///a.ts",
            languageId: "typescript",
            version: 3,
            line: 0,
            character: 6,
            triggerKind: SignatureHelpTriggerKind.Invoke,
            isRetrigger: false,
        });
        // The `triggerCharacter`/`activeSignatureHelp` keys must not be on the wire
        // at all: `{ x: undefined }` is an extra byte on every keystroke.
        expect(Object.keys(seen[0] as Record<string, unknown>).sort()).toEqual([
            "character",
            "handle",
            "isRetrigger",
            "languageId",
            "line",
            "triggerKind",
            "uri",
            "version",
        ]);
        expect(seen[1]).toEqual({
            handle: 0,
            uri: "file:///a.ts",
            languageId: "typescript",
            version: 3,
            line: 0,
            character: 6,
            triggerKind: SignatureHelpTriggerKind.TriggerCharacter,
            triggerCharacter: ",",
            isRetrigger: true,
            activeSignatureHelp: HELP,
        });
        expect(Object.keys(seen[1] as Record<string, unknown>)).toContain("activeSignatureHelp");
    });

    it("trigger characters travel as registration metadata: the host hands them to the adapter as is", async () => {
        const { host, peer } = makeHost();

        peer.notify("languages.register", {
            handle: 2,
            kind: "signatureHelp",
            selector: [{ language: "typescript" }],
            triggerCharacters: ["(", ",", 7, ""],
            retriggerCharacters: [")"],
        });
        await flushMicrotasks();

        // A non-string element and an empty string are dropped: an "empty character" would match
        // any cursor event without typing.
        expect(host.getLanguageProviders()).toEqual([
            {
                handle: 2,
                kind: "signatureHelp",
                selector: [{ language: "typescript" }],
                triggerCharacters: ["(", ","],
                retriggerCharacters: [")"],
            },
        ]);
    });

    it("document not open in the subprocess: empty without RPC", async () => {
        const { host, peer } = makeHost({ open: false });
        const provide = vi.fn(() => Promise.resolve(HELP));
        peer.handleRequest("languages.provideSignatureHelp", provide);

        expect(await host.provideSignatureHelp(0, requestOf())).toBeNull();
        expect(provide).not.toHaveBeenCalled();
    });

    it("a document exactly at the sync threshold passes, above it gives empty without RPC and a log entry", async () => {
        const length = DOCUMENT.text.length;
        const atLimit = makeHost({ maxSyncedDocumentChars: length });
        const provide = vi.fn(() => Promise.resolve(HELP));
        atLimit.peer.handleRequest("languages.provideSignatureHelp", provide);
        expect(await atLimit.host.provideSignatureHelp(0, requestOf())).toEqual(HELP);
        expect(provide).toHaveBeenCalledTimes(1);

        const warn = vi.fn();
        const over = makeHost({ warn, maxSyncedDocumentChars: length - 1 });
        over.peer.handleRequest("languages.provideSignatureHelp", provide);
        expect(await over.host.provideSignatureHelp(0, requestOf())).toBeNull();
        expect(provide).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith("skipping document sync: document too large", {
            uri: "file:///a.ts",
            length,
        });
    });

    it("after the subprocess stops the request is not sent", async () => {
        const { host, peer } = makeHost();
        const provide = vi.fn(() => Promise.resolve(HELP));
        peer.handleRequest("languages.provideSignatureHelp", provide);
        expect(await host.provideSignatureHelp(0, requestOf())).toEqual(HELP);

        await (host as unknown as { shutdownSubprocess(): Promise<void> }).shutdownSubprocess();

        expect(await host.provideSignatureHelp(0, requestOf())).toBeNull();
        expect(provide).toHaveBeenCalledTimes(1);
    });

    it("the default timeout is 5000 ms: the same cold language server as for hover", async () => {
        const { host, peer } = makeHost();
        const hostRpc = (host as unknown as { rpc: RpcEndpoint }).rpc;
        const request = vi.spyOn(hostRpc, "request");
        peer.handleRequest("languages.provideSignatureHelp", () => null);
        // The deadline travels to the transport with the request instead of being awaited live: a real
        // wait costs seconds on every mutant in the mutation run.
        await host.provideSignatureHelp(0, requestOf());
        expect(request).toHaveBeenCalledWith("languages.provideSignatureHelp", expect.anything(), { timeoutMs: 5000 });
    });

    it("after the timeout the answer is dropped and the subprocess request is cancelled", async () => {
        const debug = vi.fn();
        const { host, peer } = makeHost({ timeoutMs: 5, debug });
        let seen: ICancellationToken | undefined;
        peer.handleRequest("languages.provideSignatureHelp", async (_params, token) => {
            seen = token;
            await settle(200);
            return HELP;
        });

        expect(await host.provideSignatureHelp(0, requestOf())).toBeNull();
        // An expired deadline is a normal outcome for a slow provider: debug, not warn.
        expect(debug).toHaveBeenCalledWith('request "languages.provideSignatureHelp" timed out after 5ms');
        await vi.waitFor(() => {
            expect(seen?.isCancellationRequested).toBe(true);
        });
    });

    it("core cancellation reaches the subprocess token (provideSignatureHelp)", async () => {
        const { host, peer } = makeHost();
        let seen: ICancellationToken | null = null;
        peer.handleRequest("languages.provideSignatureHelp", (_params, token) => {
            seen = token;
            return new Promise(() => undefined);
        });

        const source = new CancellationTokenSource();
        const pending = host.provideSignatureHelp(0, requestOf(), source.token);
        await flushMicrotasks();
        expect(seen!.isCancellationRequested).toBe(false);

        source.cancel();
        await flushMicrotasks();
        expect(seen!.isCancellationRequested).toBe(true);
        void pending;
    });
});
