import { describe, expect, it, vi } from "vitest";

import { syncSourceOf } from "../../../../../TestUtils/documentSyncSource.ts";
import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import type { IRenameRequest } from "../../../../editor/common/languages/iRenameSource.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";

import { ExtensionHost } from "./extensionHost.ts";

// The channel is wired in-process: the wire is visible, plus branches unreachable through a real fork.

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
const DOCUMENT = { uri: "file:///proj/main.ts", languageId: "typescript", version: 3, text: "const value = 1;\n" };

function makeHost(
    options: ConstructorParameters<typeof ExtensionHost>[2] = {},
    withLogger = true,
    open = true,
): {
    host: ExtensionHost;
    peer: RpcEndpoint;
    warnings: { message: string; payload: unknown }[];
    debugs: string[];
} {
    const warnings: { message: string; payload: unknown }[] = [];
    const debugs: string[] = [];
    const logger = {
        info: () => undefined,
        warn: (message: string, payload: unknown) => warnings.push({ message, payload }),
        error: () => undefined,
        debug: (message: string) => debugs.push(message),
        trace: () => undefined,
    } as unknown as ILogger;
    const host = new ExtensionHost(NOOP_EDITOR_OPTIONS, NOOP_COMMANDS, {
        ...options,
        ...(withLogger ? { logger } : {}),
    });
    const [a, b] = createInProcessChannelPair();
    const hostRpc = new RpcEndpoint(a);
    const peer = new RpcEndpoint(b);
    (host as unknown as { installHostHandlers(rpc: RpcEndpoint): void }).installHostHandlers(hostRpc);
    (host as unknown as { rpc: RpcEndpoint }).rpc = hostRpc;
    if (open) host.didOpenTextDocument(syncSourceOf(DOCUMENT));
    return { host, peer, warnings, debugs };
}

const REQUEST: IRenameRequest = {
    uri: DOCUMENT.uri,
    languageId: "typescript",
    versionId: 3,
    line: 0,
    character: 8,
};

describe("ExtensionHost — rename by handle (in-process)", () => {
    it("the request goes to the subprocess whole, the new name as a separate field", async () => {
        const { host, peer } = makeHost();
        const prepare = vi.fn((_params: unknown) => Promise.resolve({ placeholder: "value" }));
        const rename = vi.fn((_params: unknown) => Promise.resolve({ applied: true }));
        peer.handleRequest("languages.prepareRename", prepare);
        peer.handleRequest("languages.provideRenameEdits", rename);

        expect(await host.prepareRename(4, REQUEST)).toEqual({ kind: "name", name: "value" });
        const wire = { uri: REQUEST.uri, languageId: "typescript", version: 3, line: 0, character: 8 };
        expect(prepare.mock.calls[0]?.[0]).toEqual({ handle: 4, ...wire });

        expect(await host.provideRenameEdits(4, REQUEST, "renamed")).toEqual({ applied: true });
        expect(rename.mock.calls[0]?.[0]).toEqual({ handle: 4, ...wire, newName: "renamed" });
    });

    it("a provider refusal arrives as a reason instead of getting lost", async () => {
        const { host, peer } = makeHost();
        peer.handleRequest("languages.prepareRename", () => Promise.resolve({ rejectReason: "not an identifier" }));
        peer.handleRequest("languages.provideRenameEdits", () =>
            Promise.resolve({ applied: false, error: "Invalid name" }),
        );

        expect(await host.prepareRename(0, REQUEST)).toEqual({ kind: "reject", reason: "not an identifier" });
        expect(await host.provideRenameEdits(0, REQUEST, "class")).toEqual({
            applied: false,
            error: "Invalid name",
        });
    });

    it("document not open in the subprocess: prepare is empty, apply is refused, no RPC", async () => {
        const { host, peer } = makeHost({}, true, false);
        const prepare = vi.fn(() => Promise.resolve({ placeholder: "value" }));
        const rename = vi.fn(() => Promise.resolve({ applied: true }));
        peer.handleRequest("languages.prepareRename", prepare);
        peer.handleRequest("languages.provideRenameEdits", rename);

        expect(await host.prepareRename(0, REQUEST)).toBeNull();
        expect(await host.provideRenameEdits(0, REQUEST, "renamed")).toEqual({
            applied: false,
            error: "The document is not available to language extensions",
        });
        expect(prepare).not.toHaveBeenCalled();
        expect(rename).not.toHaveBeenCalled();
    });

    it("a document exactly at the sync threshold passes, above it gives a refusal without RPC and a log entry", async () => {
        const length = DOCUMENT.text.length;
        const prepare = vi.fn(() => Promise.resolve({ placeholder: "value" }));
        const rename = vi.fn(() => Promise.resolve({ applied: true }));

        const atLimit = makeHost({ maxSyncedDocumentChars: length });
        atLimit.peer.handleRequest("languages.prepareRename", prepare);
        atLimit.peer.handleRequest("languages.provideRenameEdits", rename);
        expect(await atLimit.host.prepareRename(0, REQUEST)).toEqual({ kind: "name", name: "value" });
        expect(await atLimit.host.provideRenameEdits(0, REQUEST, "renamed")).toEqual({ applied: true });
        expect(atLimit.warnings).toEqual([]);

        const over = makeHost({ maxSyncedDocumentChars: length - 1 });
        over.peer.handleRequest("languages.prepareRename", prepare);
        over.peer.handleRequest("languages.provideRenameEdits", rename);
        expect(await over.host.prepareRename(0, REQUEST)).toBeNull();
        expect(await over.host.provideRenameEdits(0, REQUEST, "renamed")).toEqual({
            applied: false,
            error: "The document is not available to language extensions",
        });
        // The log has both the reason and what was wrong with the document: without the resource and length
        // the entry is indistinguishable from neighboring refusals.
        expect(over.warnings).toEqual([
            { message: "skipping document sync: document too large", payload: { uri: REQUEST.uri, length } },
        ]);
        expect(prepare).toHaveBeenCalledTimes(1);
        expect(rename).toHaveBeenCalledTimes(1);
    });

    it("a host without a logger does not crash on a too-large document but answers with a refusal", async () => {
        const { host, peer } = makeHost({ maxSyncedDocumentChars: DOCUMENT.text.length - 1 }, false);
        const prepare = vi.fn(() => Promise.resolve({ placeholder: "value" }));
        const rename = vi.fn(() => Promise.resolve({ applied: true }));
        peer.handleRequest("languages.prepareRename", prepare);
        peer.handleRequest("languages.provideRenameEdits", rename);

        expect(await host.prepareRename(0, REQUEST)).toBeNull();
        expect(await host.provideRenameEdits(0, REQUEST, "renamed")).toEqual({
            applied: false,
            error: "The document is not available to language extensions",
        });
        expect(prepare).not.toHaveBeenCalled();
        expect(rename).not.toHaveBeenCalled();
    });

    it("after the subprocess stops requests are not sent, apply answers with a refusal", async () => {
        const { host, peer } = makeHost();
        const prepare = vi.fn(() => Promise.resolve({ placeholder: "value" }));
        const rename = vi.fn(() => Promise.resolve({ applied: true }));
        peer.handleRequest("languages.prepareRename", prepare);
        peer.handleRequest("languages.provideRenameEdits", rename);

        await (host as unknown as { shutdownSubprocess(): Promise<void> }).shutdownSubprocess();

        expect(await host.prepareRename(0, REQUEST)).toBeNull();
        expect(await host.provideRenameEdits(0, REQUEST, "renamed")).toEqual({
            applied: false,
            error: "Rename failed",
        });
        expect(prepare).not.toHaveBeenCalled();
        expect(rename).not.toHaveBeenCalled();
    });

    it("after the timeout prepare answers null, apply a refusal WITH a message", async () => {
        const { host, peer, warnings, debugs } = makeHost({
            requestTimeouts: { "languages.prepareRename": 10, "languages.provideRenameEdits": 10 },
        });
        const tokens: ICancellationToken[] = [];
        const hang = (_params: unknown, token: ICancellationToken): Promise<never> => {
            tokens.push(token);
            return new Promise<never>(() => undefined);
        };
        peer.handleRequest("languages.prepareRename", hang);
        peer.handleRequest("languages.provideRenameEdits", hang);

        expect(await host.prepareRename(0, REQUEST)).toBeNull();
        expect(await host.provideRenameEdits(0, REQUEST, "renamed")).toEqual({
            applied: false,
            error: "Rename timed out",
        });
        // An expired deadline is debug with the method, not warn.
        expect(debugs).toEqual([
            'request "languages.prepareRename" timed out after 10ms',
            'request "languages.provideRenameEdits" timed out after 10ms',
        ]);
        expect(warnings).toEqual([]);
        await vi.waitFor(() => {
            expect(tokens.map((token) => token.isCancellationRequested)).toEqual([true, true]);
        });
    });
});
