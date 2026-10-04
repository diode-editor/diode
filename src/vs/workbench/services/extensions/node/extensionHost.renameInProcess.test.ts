import { describe, expect, it, vi } from "vitest";

import type { IRenameRequest } from "../../../../editor/common/languages/iRenameSource.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";

import { ExtensionHost } from "./extensionHost.ts";

/**
 * Rename по handle: субпроцесса нет, канал сшит in-process — так видно, что
 * уезжает субпроцессу (документ, позиция, новое имя), что отсекается по
 * размеру и таймауту и что остановка субпроцесса отрезает запросы.
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

/** Лимит текста запроса — общий `MAX_WILL_SAVE_TEXT_BYTES` хоста. */
const MAX_TEXT_BYTES = 8 * 1024 * 1024;

function makeHost(
    options: ConstructorParameters<typeof ExtensionHost>[2] = {},
    withLogger = true,
): {
    host: ExtensionHost;
    peer: RpcEndpoint;
    warnings: { message: string; payload: unknown }[];
} {
    const warnings: { message: string; payload: unknown }[] = [];
    const logger = {
        info: () => undefined,
        warn: (message: string, payload: unknown) => warnings.push({ message, payload }),
        error: () => undefined,
        debug: () => undefined,
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
    return { host, peer, warnings };
}

const REQUEST: IRenameRequest = {
    uri: "file:///proj/main.ts",
    languageId: "typescript",
    text: "const value = 1;\n",
    line: 0,
    character: 8,
};

describe("ExtensionHost — rename по handle (in-process)", () => {
    it("запрос уезжает субпроцессу целиком, новое имя — отдельным полем", async () => {
        const { host, peer } = makeHost();
        const prepare = vi.fn((_params: unknown) => Promise.resolve({ placeholder: "value" }));
        const rename = vi.fn((_params: unknown) => Promise.resolve({ applied: true }));
        peer.handleRequest("languages.prepareRename", prepare);
        peer.handleRequest("languages.provideRenameEdits", rename);

        expect(await host.prepareRename(4, REQUEST)).toEqual({ kind: "name", name: "value" });
        expect(prepare.mock.calls[0]?.[0]).toEqual({ handle: 4, ...REQUEST });

        expect(await host.provideRenameEdits(4, REQUEST, "renamed")).toEqual({ applied: true });
        expect(rename.mock.calls[0]?.[0]).toEqual({ handle: 4, ...REQUEST, newName: "renamed" });
    });

    it("отказ провайдера доезжает причиной, а не теряется", async () => {
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

    it("документ ровно в лимит проходит, больше лимита — отсекается с записью в лог", async () => {
        const { host, peer, warnings } = makeHost();
        const prepare = vi.fn(() => Promise.resolve({ placeholder: "value" }));
        const rename = vi.fn(() => Promise.resolve({ applied: true }));
        peer.handleRequest("languages.prepareRename", prepare);
        peer.handleRequest("languages.provideRenameEdits", rename);

        const atLimit = { ...REQUEST, text: "x".repeat(MAX_TEXT_BYTES) };
        expect(await host.prepareRename(0, atLimit)).toEqual({ kind: "name", name: "value" });
        expect(await host.provideRenameEdits(0, atLimit, "renamed")).toEqual({ applied: true });
        expect(warnings).toEqual([]);

        const tooBig = { ...REQUEST, text: "x".repeat(MAX_TEXT_BYTES + 1) };
        expect(await host.prepareRename(0, tooBig)).toBeNull();
        expect(await host.provideRenameEdits(0, tooBig, "renamed")).toEqual({
            applied: false,
            error: "Document too large to rename",
        });
        // В логе — и повод, и чем документ не угодил: без ресурса и длины
        // запись не отличить от соседних отказов.
        expect(warnings).toEqual([
            {
                message: "skipping prepare rename: document too large",
                payload: { uri: REQUEST.uri, length: MAX_TEXT_BYTES + 1 },
            },
            {
                message: "skipping rename: document too large",
                payload: { uri: REQUEST.uri, length: MAX_TEXT_BYTES + 1 },
            },
        ]);
        expect(prepare).toHaveBeenCalledTimes(1);
        expect(rename).toHaveBeenCalledTimes(1);
    });

    it("хост без логгера на слишком большом документе не падает, а отвечает отказом", async () => {
        const { host, peer } = makeHost({}, false);
        const prepare = vi.fn(() => Promise.resolve({ placeholder: "value" }));
        const rename = vi.fn(() => Promise.resolve({ applied: true }));
        peer.handleRequest("languages.prepareRename", prepare);
        peer.handleRequest("languages.provideRenameEdits", rename);

        const tooBig = { ...REQUEST, text: "x".repeat(MAX_TEXT_BYTES + 1) };
        expect(await host.prepareRename(0, tooBig)).toBeNull();
        expect(await host.provideRenameEdits(0, tooBig, "renamed")).toEqual({
            applied: false,
            error: "Document too large to rename",
        });
        expect(prepare).not.toHaveBeenCalled();
        expect(rename).not.toHaveBeenCalled();
    });

    it("после остановки субпроцесса запросы не уходят, применение отвечает отказом", async () => {
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

    it("по истечении таймаута prepare отвечает null, применение — отказом С сообщением", async () => {
        const { host, peer } = makeHost({ prepareRenameTimeoutMs: 10, renameTimeoutMs: 10 });
        peer.handleRequest("languages.prepareRename", () => new Promise(() => undefined));
        peer.handleRequest("languages.provideRenameEdits", () => new Promise(() => undefined));

        expect(await host.prepareRename(0, REQUEST)).toBeNull();
        expect(await host.provideRenameEdits(0, REQUEST, "renamed")).toEqual({
            applied: false,
            error: "Rename timed out",
        });
    });
});
