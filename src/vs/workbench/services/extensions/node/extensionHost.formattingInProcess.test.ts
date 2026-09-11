import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { IFormattingRequest } from "../../../../editor/common/languages/iFormattingSource.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";

import { ExtensionHost } from "./extensionHost.ts";

/**
 * Гейт запроса форматирования: субпроцесса нет, канал сшит in-process — так
 * проверяются ветки, недостижимые через настоящий fork (подписка ещё не
 * пришла, отсечка по размеру документа, форма параметров RPC). Образец —
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

const MAX_TEXT_BYTES = 8 * 1024 * 1024;

const WIRE_EDIT = { range: { startLine: 0, startCharacter: 5, endLine: 0, endCharacter: 7 }, text: " " };

function requestOf(text: string, patch: Partial<IFormattingRequest> = {}): IFormattingRequest {
    return {
        uri: "file:///a.ts",
        languageId: "typescript",
        text,
        tabSize: 2,
        insertSpaces: true,
        ...patch,
    };
}

function makeHost(options: { warn?: ILogger["warn"] } = {}): { host: ExtensionHost; peer: RpcEndpoint } {
    const logger =
        options.warn === undefined
            ? undefined
            : ({ warn: options.warn, info: () => undefined, error: () => undefined } as unknown as ILogger);
    const host = new ExtensionHost(NOOP_EDITOR_OPTIONS, NOOP_COMMANDS, {
        ...(logger === undefined ? {} : { logger }),
    });
    const [a, b] = createInProcessChannelPair();
    const hostRpc = new RpcEndpoint(a);
    const peer = new RpcEndpoint(b);
    (host as unknown as { installHostHandlers(rpc: RpcEndpoint): void }).installHostHandlers(hostRpc);
    (host as unknown as { rpc: RpcEndpoint }).rpc = hostRpc;
    return { host, peer };
}

describe("ExtensionHost — гейт форматирования (in-process)", () => {
    it("без подписки — null без RPC; после hasFormattingProviders — запрос уходит", async () => {
        const { host, peer } = makeHost();
        const provide = vi.fn(() => Promise.resolve([WIRE_EDIT]));
        peer.handleRequest("languages.provideFormattingEdits", provide);

        expect(await host.provideFormattingEdits(requestOf("const  a=1;\n"))).toBeNull();
        expect(provide).not.toHaveBeenCalled();

        peer.notify("languages.updateSubscriptions", { hasFormattingProviders: true });
        await flushMicrotasks();

        expect(await host.provideFormattingEdits(requestOf("const  a=1;\n"))).toEqual([
            { range: { start: { line: 0, character: 5 }, end: { line: 0, character: 7 } }, text: " " },
        ]);
        expect(provide).toHaveBeenCalledTimes(1);
    });

    it("параметры едут как есть; range сериализуется в wire-форму и не выдумывается без него", async () => {
        const { host, peer } = makeHost();
        const seen: unknown[] = [];
        peer.handleRequest("languages.provideFormattingEdits", (params) => {
            seen.push(params);
            return Promise.resolve(null);
        });
        peer.notify("languages.updateSubscriptions", { hasFormattingProviders: true });
        await flushMicrotasks();

        expect(await host.provideFormattingEdits(requestOf("x"))).toBeNull();
        await host.provideFormattingEdits(requestOf("x", { range: createRange(1, 2, 3, 4) }));

        expect(seen).toEqual([
            { uri: "file:///a.ts", languageId: "typescript", text: "x", tabSize: 2, insertSpaces: true },
            {
                uri: "file:///a.ts",
                languageId: "typescript",
                text: "x",
                tabSize: 2,
                insertSpaces: true,
                range: { startLine: 1, startCharacter: 2, endLine: 3, endCharacter: 4 },
            },
        ]);
    });

    it("слишком большой документ — [] без RPC (не «нет форматтера») + warn", async () => {
        const warn = vi.fn();
        const { host, peer } = makeHost({ warn });
        const provide = vi.fn(() => Promise.resolve([WIRE_EDIT]));
        peer.handleRequest("languages.provideFormattingEdits", provide);
        peer.notify("languages.updateSubscriptions", { hasFormattingProviders: true });
        await flushMicrotasks();

        const huge = "x".repeat(MAX_TEXT_BYTES + 1);
        expect(await host.provideFormattingEdits(requestOf(huge))).toEqual([]);
        expect(provide).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledExactlyOnceWith("skipping formatting: document too large", {
            uri: "file:///a.ts",
            length: MAX_TEXT_BYTES + 1,
        });

        // Ровно на границе — не «слишком большой»: запрос уходит.
        const exact = "x".repeat(MAX_TEXT_BYTES);
        await host.provideFormattingEdits(requestOf(exact));
        expect(provide).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledOnce();
    });

    it("слишком большой документ без логгера — тот же [], без падения на warn", async () => {
        const { host, peer } = makeHost();
        const provide = vi.fn(() => Promise.resolve([WIRE_EDIT]));
        peer.handleRequest("languages.provideFormattingEdits", provide);
        peer.notify("languages.updateSubscriptions", { hasFormattingProviders: true });
        await flushMicrotasks();

        expect(await host.provideFormattingEdits(requestOf("x".repeat(MAX_TEXT_BYTES + 1)))).toEqual([]);
        expect(provide).not.toHaveBeenCalled();
    });

    it("чужая форма подписки (не true) не включает гейт", async () => {
        const { host, peer } = makeHost();
        const provide = vi.fn(() => Promise.resolve([WIRE_EDIT]));
        peer.handleRequest("languages.provideFormattingEdits", provide);
        peer.notify("languages.updateSubscriptions", { hasFormattingProviders: "true" });
        await flushMicrotasks();

        expect(await host.provideFormattingEdits(requestOf("x"))).toBeNull();
        expect(provide).not.toHaveBeenCalled();
    });
});
