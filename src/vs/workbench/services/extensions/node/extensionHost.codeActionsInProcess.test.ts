import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ICodeActionRequest } from "../../../../editor/common/languages/iCodeActionSource.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";

import { ExtensionHost } from "./extensionHost.ts";

/**
 * Гейт запросов code actions: субпроцесса нет, канал сшит in-process — так
 * проверяются ветки, недостижимые через настоящий fork (подписка ещё не
 * пришла, отсечка по размеру, форма параметров). Образец —
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

const MAX_TEXT_BYTES = 8 * 1024 * 1024;

const WIRE_ACTION = { id: "1.0", title: "Fix", kind: "quickfix" };

function requestOf(text: string, patch: Partial<ICodeActionRequest> = {}): ICodeActionRequest {
    return {
        uri: "file:///a.py",
        languageId: "python",
        text,
        range: createRange(0, 0, 0, 1),
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

describe("ExtensionHost — гейт code actions (in-process)", () => {
    it("без подписки provide → null и apply → false, RPC не гоняется", async () => {
        const { host, peer } = makeHost();
        const provide = vi.fn(() => Promise.resolve([WIRE_ACTION]));
        const apply = vi.fn(() => Promise.resolve(true));
        peer.handleRequest("languages.provideCodeActions", provide);
        peer.handleRequest("languages.applyCodeAction", apply);

        expect(await host.provideCodeActions(requestOf("x"))).toBeNull();
        expect(await host.applyCodeAction("1.0")).toBe(false);
        expect(provide).not.toHaveBeenCalled();
        expect(apply).not.toHaveBeenCalled();

        peer.notify("languages.updateSubscriptions", { hasCodeActionsProviders: true });
        await flushMicrotasks();

        expect(await host.provideCodeActions(requestOf("x"))).toEqual([WIRE_ACTION]);
        expect(await host.applyCodeAction("1.0")).toBe(true);
        expect(apply).toHaveBeenCalledExactlyOnceWith({ id: "1.0" });
    });

    it("параметры provide едут как есть; only не выдумывается без запроса", async () => {
        const { host, peer } = makeHost();
        const seen: unknown[] = [];
        peer.handleRequest("languages.provideCodeActions", (params) => {
            seen.push(params);
            return Promise.resolve(null);
        });
        peer.notify("languages.updateSubscriptions", { hasCodeActionsProviders: true });
        await flushMicrotasks();

        expect(await host.provideCodeActions(requestOf("x", { range: createRange(1, 2, 3, 4) }))).toBeNull();
        await host.provideCodeActions(requestOf("x", { only: "source.organizeImports" }));
        // Automatic-триггер лампочки едет как есть (команды поля не шлют).
        await host.provideCodeActions(requestOf("x", { triggerKind: 2 }));

        expect(seen).toEqual([
            {
                uri: "file:///a.py",
                languageId: "python",
                text: "x",
                range: { startLine: 1, startCharacter: 2, endLine: 3, endCharacter: 4 },
            },
            {
                uri: "file:///a.py",
                languageId: "python",
                text: "x",
                range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 1 },
                only: "source.organizeImports",
            },
            {
                uri: "file:///a.py",
                languageId: "python",
                text: "x",
                range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 1 },
                triggerKind: 2,
            },
        ]);
    });

    it("слишком большой документ — [] без RPC + warn; без логгера не падает", async () => {
        const warn = vi.fn();
        const { host, peer } = makeHost({ warn });
        const provide = vi.fn(() => Promise.resolve([WIRE_ACTION]));
        peer.handleRequest("languages.provideCodeActions", provide);
        peer.notify("languages.updateSubscriptions", { hasCodeActionsProviders: true });
        await flushMicrotasks();

        const huge = "x".repeat(MAX_TEXT_BYTES + 1);
        expect(await host.provideCodeActions(requestOf(huge))).toEqual([]);
        expect(provide).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledExactlyOnceWith("skipping code actions: document too large", {
            uri: "file:///a.py",
            length: MAX_TEXT_BYTES + 1,
        });

        // Ровно на границе — запрос уходит.
        await host.provideCodeActions(requestOf("x".repeat(MAX_TEXT_BYTES)));
        expect(provide).toHaveBeenCalledTimes(1);

        const silent = makeHost();
        silent.peer.handleRequest("languages.provideCodeActions", provide);
        silent.peer.notify("languages.updateSubscriptions", { hasCodeActionsProviders: true });
        await flushMicrotasks();
        expect(await silent.host.provideCodeActions(requestOf(huge))).toEqual([]);
    });

    it("чужая форма подписки (не true) не включает гейт", async () => {
        const { host, peer } = makeHost();
        peer.notify("languages.updateSubscriptions", { hasCodeActionsProviders: "true" });
        await flushMicrotasks();
        expect(await host.provideCodeActions(requestOf("x"))).toBeNull();
    });
});
