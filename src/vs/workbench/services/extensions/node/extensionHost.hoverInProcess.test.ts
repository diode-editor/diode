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
 * Регистрации языковых провайдеров и hover-запрос по handle: субпроцесса нет,
 * канал сшит in-process — так проверяются ветки, недостижимые через настоящий
 * fork (чужая форма нотификации, отсечка по размеру документа, дефолтный таймаут). Образец —
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

function makeHost(options: { warn?: ILogger["warn"]; hoverTimeoutMs?: number } = {}): {
    host: ExtensionHost;
    peer: RpcEndpoint;
} {
    const logger =
        options.warn === undefined
            ? undefined
            : ({ warn: options.warn, info: () => undefined, error: () => undefined } as unknown as ILogger);
    const host = new ExtensionHost(NOOP_EDITOR_OPTIONS, NOOP_COMMANDS, {
        ...(logger === undefined ? {} : { logger }),
        ...(options.hoverTimeoutMs === undefined ? {} : { hoverTimeoutMs: options.hoverTimeoutMs }),
    });
    const [a, b] = createInProcessChannelPair();
    const hostRpc = new RpcEndpoint(a);
    const peer = new RpcEndpoint(b);
    (host as unknown as { installHostHandlers(rpc: RpcEndpoint): void }).installHostHandlers(hostRpc);
    (host as unknown as { rpc: RpcEndpoint }).rpc = hostRpc;
    return { host, peer };
}

const HOVER_REGISTRATION = { handle: 7, kind: "hover", selector: [{ language: "typescript" }] };

describe("ExtensionHost — регистрации языковых провайдеров (in-process)", () => {
    it("languages.register/unregister ведут список провайдеров и будят слушателей", async () => {
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

    it("чужая форма регистрации и снятие неизвестного handle игнорируются без события", async () => {
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

    it("отписка снимает только своего слушателя", async () => {
        const { host, peer } = makeHost();
        const kept = vi.fn();
        const removed = vi.fn();
        // Снимаемый — первым: его индекс 0 тоже должен вычищаться.
        const sub = host.onLanguageProvidersChanged(removed);
        host.onLanguageProvidersChanged(kept);
        sub.dispose();
        sub.dispose();

        peer.notify("languages.register", HOVER_REGISTRATION);
        await flushMicrotasks();

        expect(kept).toHaveBeenCalledTimes(1);
        expect(removed).not.toHaveBeenCalled();
    });

    it("остановка субпроцесса снимает все регистрации одним событием", async () => {
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

    it("остановка без регистраций событий не порождает", async () => {
        const { host } = makeHost();
        const changed = vi.fn();
        host.onLanguageProvidersChanged(changed);

        await (host as unknown as { shutdownSubprocess(): Promise<void> }).shutdownSubprocess();

        expect(changed).not.toHaveBeenCalled();
    });
});

describe("ExtensionHost — hover-запрос по handle (in-process)", () => {
    it("запрос несёт handle провайдера и снапшот документа", async () => {
        const { host, peer } = makeHost();
        const provide = vi.fn((_params: unknown) => Promise.resolve({ contents: ["const a: number"] }));
        peer.handleRequest("languages.provideHover", provide);

        expect(await host.provideHover(7, requestOf("const a = 1;\n"))).toEqual({ contents: ["const a: number"] });
        expect(provide.mock.calls[0]?.[0]).toEqual({ handle: 7, ...requestOf("const a = 1;\n") });
    });

    it("документ ровно в лимит проходит, больше лимита — отсекается с записью в лог", async () => {
        const warn = vi.fn();
        const { host, peer } = makeHost({ warn });
        const provide = vi.fn(() => Promise.resolve({ contents: ["ok"] }));
        peer.handleRequest("languages.provideHover", provide);

        // Граница включительная: 8 МБ ровно — ещё гоняем.
        expect(await host.provideHover(1, requestOf("x".repeat(MAX_TEXT_BYTES)))).toEqual({ contents: ["ok"] });
        expect(provide).toHaveBeenCalledTimes(1);
        expect(warn).not.toHaveBeenCalled();

        // На символ больше — не гоняем и пишем, что и почему пропустили.
        expect(await host.provideHover(1, requestOf("x".repeat(MAX_TEXT_BYTES + 1)))).toBeUndefined();
        expect(provide).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith("skipping hover: document too large", {
            uri: "file:///a.ts",
            length: MAX_TEXT_BYTES + 1,
        });
    });

    it("после остановки субпроцесса запрос не уходит", async () => {
        const { host, peer } = makeHost();
        const provide = vi.fn(() => Promise.resolve({ contents: ["жив"] }));
        peer.handleRequest("languages.provideHover", provide);
        expect(await host.provideHover(1, requestOf("x"))).toEqual({ contents: ["жив"] });

        await (host as unknown as { shutdownSubprocess(): Promise<void> }).shutdownSubprocess();

        expect(await host.provideHover(1, requestOf("x"))).toBeUndefined();
        expect(provide).toHaveBeenCalledTimes(1);
    });

    it("дефолт таймаута — 5000 мс, как у definition (холодный сервер индексирует секундами)", () => {
        const { host } = makeHost();
        // Читаем разрешённую опцию, а не ждём вживую: реальное ожидание в
        // мутационном прогоне стоит полсекунды на каждом покрывающем мутанте.
        expect((host as unknown as { options: { hoverTimeoutMs: number } }).options.hoverTimeoutMs).toBe(5000);
    });

    it("по истечении таймаута ответ отбрасывается", async () => {
        const { host, peer } = makeHost({ hoverTimeoutMs: 5 });
        peer.handleRequest("languages.provideHover", async () => {
            await settle(200);
            return { contents: ["опоздал"] };
        });

        expect(await host.provideHover(1, requestOf("x"))).toBeUndefined();
    });
});
