import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks, settle } from "../../../../../TestUtils/timing.ts";
import type { IHoverRequest } from "../../../../editor/common/languages/iHoverSource.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";

import { ExtensionHost } from "./extensionHost.ts";

/**
 * Гейт hover-запроса: субпроцесса нет, канал сшит in-process — так проверяются
 * ветки, недостижимые через настоящий fork (подписки ещё не пришло, чужая форма
 * нотификации, отсечка по размеру документа, дефолтный таймаут). Образец —
 * `extensionHost.completionInProcess.test.ts`.
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

function requestOf(text: string): IHoverRequest {
    return { uri: "file:///a.ts", languageId: "typescript", text, line: 0, character: 0 };
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

describe("ExtensionHost — гейт hover-запроса (in-process)", () => {
    it("без подписки RPC не гоняется; после hasHoverProviders — гоняется", async () => {
        const { host, peer } = makeHost();
        const provide = vi.fn(() => Promise.resolve([{ contents: ["const a: number"] }]));
        peer.handleRequest("languages.provideHover", provide);

        // Субпроцесс ещё не сообщил о провайдерах: запрос не уходит вовсе.
        expect(await host.provideHover(requestOf("const a = 1;\n"))).toEqual([]);
        expect(provide).not.toHaveBeenCalled();

        peer.notify("languages.updateSubscriptions", { hasHoverProviders: true });
        await flushMicrotasks();

        expect(await host.provideHover(requestOf("const a = 1;\n"))).toEqual([{ contents: ["const a: number"] }]);
        expect(provide).toHaveBeenCalledTimes(1);
    });

    it("чужая форма подписки читается как «провайдеров нет»", async () => {
        const { host, peer } = makeHost();
        peer.handleRequest("languages.provideHover", () => Promise.resolve([{ contents: ["x"] }]));

        peer.notify("languages.updateSubscriptions", { hasHoverProviders: true });
        await flushMicrotasks();
        expect(await host.provideHover(requestOf("x"))).toEqual([{ contents: ["x"] }]);

        // Только строгое `true` включает подписку: строка "true" — не она.
        peer.notify("languages.updateSubscriptions", { hasHoverProviders: "true" });
        await flushMicrotasks();
        expect(await host.provideHover(requestOf("x"))).toEqual([]);

        // Поле отсутствует вовсе — тоже выключено.
        peer.notify("languages.updateSubscriptions", { hasHoverProviders: true });
        await flushMicrotasks();
        peer.notify("languages.updateSubscriptions", {});
        await flushMicrotasks();
        expect(await host.provideHover(requestOf("x"))).toEqual([]);
    });

    it("документ ровно в лимит проходит, больше лимита — отсекается с записью в лог", async () => {
        const warn = vi.fn();
        const { host, peer } = makeHost({ warn });
        const provide = vi.fn(() => Promise.resolve([{ contents: ["ok"] }]));
        peer.handleRequest("languages.provideHover", provide);
        peer.notify("languages.updateSubscriptions", { hasHoverProviders: true });
        await flushMicrotasks();

        // Граница включительная: 8 МБ ровно — ещё гоняем.
        expect(await host.provideHover(requestOf("x".repeat(MAX_TEXT_BYTES)))).toEqual([{ contents: ["ok"] }]);
        expect(provide).toHaveBeenCalledTimes(1);
        expect(warn).not.toHaveBeenCalled();

        // На символ больше — не гоняем и пишем, что и почему пропустили.
        expect(await host.provideHover(requestOf("x".repeat(MAX_TEXT_BYTES + 1)))).toEqual([]);
        expect(provide).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith("skipping hover: document too large", {
            uri: "file:///a.ts",
            length: MAX_TEXT_BYTES + 1,
        });
    });

    it("после остановки субпроцесса подписка сброшена — hover не гоняется до новой", async () => {
        const { host, peer } = makeHost();
        const provide = vi.fn(() => Promise.resolve([{ contents: ["жив"] }]));
        peer.handleRequest("languages.provideHover", provide);
        peer.notify("languages.updateSubscriptions", { hasHoverProviders: true });
        await flushMicrotasks();
        expect(await host.provideHover(requestOf("x"))).toEqual([{ contents: ["жив"] }]);

        // Субпроцесс умер: провайдеры умерли вместе с ним, и до нового
        // updateSubscriptions запрос уходить не должен.
        await (host as unknown as { shutdownSubprocess(): Promise<void> }).shutdownSubprocess();

        expect(await host.provideHover(requestOf("x"))).toEqual([]);
        expect(provide).toHaveBeenCalledTimes(1);
    });

    it("дефолтный таймаут щедрый: ответ через полсекунды доезжает", async () => {
        const { host, peer } = makeHost();
        peer.handleRequest("languages.provideHover", async () => {
            await settle(500);
            return [{ contents: ["не спешил"] }];
        });
        peer.notify("languages.updateSubscriptions", { hasHoverProviders: true });
        await flushMicrotasks();

        expect(await host.provideHover(requestOf("x"))).toEqual([{ contents: ["не спешил"] }]);
    });
});
