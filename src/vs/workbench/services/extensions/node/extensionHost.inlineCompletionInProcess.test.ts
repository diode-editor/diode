import { describe, expect, it, vi } from "vitest";

import { syncSourceOf } from "../../../../../TestUtils/documentSyncSource.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { CancellationTokenSource, type ICancellationToken } from "../../../../base/common/cancellation.ts";
import { InlineCompletionTriggerKind } from "../../../../editor/common/languages/iInlineCompletionSource.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";

import { ExtensionHost } from "./extensionHost.ts";

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
const DOCUMENT = { uri: "file:///proj/main.ts", languageId: "typescript", version: 3, text: "con" };

const REQ = {
    uri: DOCUMENT.uri,
    languageId: "typescript",
    versionId: 3,
    line: 0,
    character: 3,
    triggerKind: InlineCompletionTriggerKind.Invoke,
};

function makeHost(open = true): { host: ExtensionHost; peer: RpcEndpoint } {
    const host = new ExtensionHost(NOOP_EDITOR_OPTIONS, NOOP_COMMANDS, {});
    const [a, b] = createInProcessChannelPair();
    const hostRpc = new RpcEndpoint(a);
    const peer = new RpcEndpoint(b);
    (host as unknown as { installHostHandlers(rpc: RpcEndpoint): void }).installHostHandlers(hostRpc);
    (host as unknown as { rpc: RpcEndpoint }).rpc = hostRpc;
    if (open) host.didOpenTextDocument(syncSourceOf(DOCUMENT));
    return { host, peer };
}

describe("ExtensionHost — inline completions (in-process)", () => {
    it("proxy calls with one request make one RPC with a batch of handles; responses go to their owners", async () => {
        const { host, peer } = makeHost();
        const seen = vi.fn((params: unknown) => {
            void params;
            return [[{ insertText: " = 42;" }], [{ insertText: " = 7;" }]];
        });
        peer.handleRequest("languages.provideInlineCompletions", seen);

        const [first, second] = await Promise.all([
            host.provideInlineCompletions(3, REQ),
            host.provideInlineCompletions(8, REQ),
        ]);

        expect(first).toEqual([{ insertText: " = 42;" }]);
        expect(second).toEqual([{ insertText: " = 7;" }]);
        // The handler's second argument is the cancellation token from the receiving RpcEndpoint.
        expect(seen).toHaveBeenCalledExactlyOnceWith(
            {
                handles: [3, 8],
                uri: DOCUMENT.uri,
                languageId: "typescript",
                version: 3,
                line: 0,
                character: 3,
                triggerKind: InlineCompletionTriggerKind.Invoke,
            },
            expect.objectContaining({ isCancellationRequested: false }),
        );
    });

    it("document not open in the subprocess: empty without RPC", async () => {
        const { host, peer } = makeHost(false);
        const seen = vi.fn(() => [[{ insertText: "x" }]]);
        peer.handleRequest("languages.provideInlineCompletions", seen);

        expect(await host.provideInlineCompletions(0, REQ)).toEqual([]);
        expect(seen).not.toHaveBeenCalled();
    });

    it("no request is sent after the subprocess stops", async () => {
        const { host, peer } = makeHost();
        const seen = vi.fn(() => [[{ insertText: "x" }]]);
        peer.handleRequest("languages.provideInlineCompletions", seen);

        await (host as unknown as { shutdownSubprocess(): Promise<void> }).shutdownSubprocess();

        expect(await host.provideInlineCompletions(0, REQ)).toEqual([]);
        expect(seen).not.toHaveBeenCalled();
    });

    it("core cancellation reaches the subprocess token and stops the provider's work", async () => {
        const { host, peer } = makeHost();
        let seen: ICancellationToken | null = null;
        let release: (value: unknown) => void = () => undefined;
        peer.handleRequest("languages.provideInlineCompletions", (_params, token) => {
            seen = token;
            return new Promise((resolve) => {
                release = resolve;
            });
        });

        const source = new CancellationTokenSource();
        const pending = host.provideInlineCompletions(0, REQ, source.token);
        await flushMicrotasks();
        expect(seen!.isCancellationRequested).toBe(false);

        source.cancel();
        await flushMicrotasks();
        expect(seen!.isCancellationRequested).toBe(true);

        release([[{ insertText: "late" }]]);
        // The extension layer does not suppress a cancelled request's response; the core
        // (InlineCompletionsService) discards it, here the bridge just passes on what arrived.
        expect(await pending).toEqual([{ insertText: "late" }]);
    });

    it("an expired timeout cancels the subprocess request", async () => {
        const host = new ExtensionHost(NOOP_EDITOR_OPTIONS, NOOP_COMMANDS, {
            requestTimeouts: { "languages.provideInlineCompletions": 20 },
        });
        const [a, b] = createInProcessChannelPair();
        const hostRpc = new RpcEndpoint(a);
        const peer = new RpcEndpoint(b);
        (host as unknown as { installHostHandlers(rpc: RpcEndpoint): void }).installHostHandlers(hostRpc);
        (host as unknown as { rpc: RpcEndpoint }).rpc = hostRpc;
        host.didOpenTextDocument(syncSourceOf(DOCUMENT));

        let seen: ICancellationToken | null = null;
        peer.handleRequest("languages.provideInlineCompletions", (_params, token) => {
            seen = token;
            return new Promise(() => undefined);
        });

        expect(await host.provideInlineCompletions(0, REQ)).toEqual([]);
        await flushMicrotasks();
        expect(seen!.isCancellationRequested).toBe(true);
    });
});
