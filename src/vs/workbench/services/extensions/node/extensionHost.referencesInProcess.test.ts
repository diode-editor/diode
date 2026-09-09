import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks, settle } from "../../../../../TestUtils/timing.ts";
import type { IReferenceRequest } from "../../../../editor/common/languages/iReferenceSource.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";

import { ExtensionHost } from "./extensionHost.ts";

/**
 * Гейт references-запроса: субпроцесса нет, канал сшит in-process — так
 * проверяются ветки, недостижимые через настоящий fork (подписка ещё не пришла,
 * чужая форма нотификации, отсечка по размеру документа, дефолтный таймаут).
 * Образец — `extensionHost.hoverInProcess.test.ts`.
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

const REF = { uri: "file:///a.ts", range: { startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 3 } };
const CORE_REF = { uri: "file:///a.ts", range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } } };

function requestOf(text: string): IReferenceRequest {
    return { uri: "file:///a.ts", languageId: "typescript", text, line: 0, character: 0, includeDeclaration: true };
}

function makeHost(
    options: { warn?: ILogger["warn"]; referencesTimeoutMs?: number } = {},
): { host: ExtensionHost; peer: RpcEndpoint } {
    const logger =
        options.warn === undefined
            ? undefined
            : ({ warn: options.warn, info: () => undefined, error: () => undefined } as unknown as ILogger);
    const host = new ExtensionHost(NOOP_EDITOR_OPTIONS, NOOP_COMMANDS, {
        ...(logger === undefined ? {} : { logger }),
        ...(options.referencesTimeoutMs === undefined ? {} : { referencesTimeoutMs: options.referencesTimeoutMs }),
    });
    const [a, b] = createInProcessChannelPair();
    const hostRpc = new RpcEndpoint(a);
    const peer = new RpcEndpoint(b);
    (host as unknown as { installHostHandlers(rpc: RpcEndpoint): void }).installHostHandlers(hostRpc);
    (host as unknown as { rpc: RpcEndpoint }).rpc = hostRpc;
    return { host, peer };
}

describe("ExtensionHost — гейт references-запроса (in-process)", () => {
    it("без подписки RPC не гоняется; после hasReferenceProviders — гоняется", async () => {
        const { host, peer } = makeHost();
        const provide = vi.fn(() => Promise.resolve([REF]));
        peer.handleRequest("languages.provideReferences", provide);

        // Субпроцесс ещё не сообщил о провайдерах: запрос не уходит вовсе.
        expect(await host.provideReferences(requestOf("const a = 1;\n"))).toEqual([]);
        expect(provide).not.toHaveBeenCalled();

        peer.notify("languages.updateSubscriptions", { hasReferenceProviders: true });
        await flushMicrotasks();

        expect(await host.provideReferences(requestOf("const a = 1;\n"))).toEqual([CORE_REF]);
        expect(provide).toHaveBeenCalledTimes(1);
    });

    it("контекст includeDeclaration уходит в субпроцесс как есть", async () => {
        const { host, peer } = makeHost();
        const seen: unknown[] = [];
        peer.handleRequest("languages.provideReferences", (params) => {
            seen.push(params);
            return Promise.resolve([]);
        });
        peer.notify("languages.updateSubscriptions", { hasReferenceProviders: true });
        await flushMicrotasks();

        await host.provideReferences({ ...requestOf("x"), includeDeclaration: false });

        expect(seen).toEqual([
            {
                uri: "file:///a.ts",
                languageId: "typescript",
                text: "x",
                line: 0,
                character: 0,
                includeDeclaration: false,
            },
        ]);
    });

    it("чужая форма подписки читается как «провайдеров нет»", async () => {
        const { host, peer } = makeHost();
        peer.handleRequest("languages.provideReferences", () => Promise.resolve([REF]));

        peer.notify("languages.updateSubscriptions", { hasReferenceProviders: true });
        await flushMicrotasks();
        expect(await host.provideReferences(requestOf("x"))).toEqual([CORE_REF]);

        // Только строгое `true` включает подписку: строка "true" — не она.
        peer.notify("languages.updateSubscriptions", { hasReferenceProviders: "true" });
        await flushMicrotasks();
        expect(await host.provideReferences(requestOf("x"))).toEqual([]);

        // Поле отсутствует вовсе — тоже выключено.
        peer.notify("languages.updateSubscriptions", { hasReferenceProviders: true });
        await flushMicrotasks();
        peer.notify("languages.updateSubscriptions", {});
        await flushMicrotasks();
        expect(await host.provideReferences(requestOf("x"))).toEqual([]);
    });

    it("документ ровно в лимит проходит, больше лимита — отсекается с записью в лог", async () => {
        const warn = vi.fn();
        const { host, peer } = makeHost({ warn });
        const provide = vi.fn(() => Promise.resolve([REF]));
        peer.handleRequest("languages.provideReferences", provide);
        peer.notify("languages.updateSubscriptions", { hasReferenceProviders: true });
        await flushMicrotasks();

        // Граница включительная: 8 МБ ровно — ещё гоняем.
        expect(await host.provideReferences(requestOf("x".repeat(MAX_TEXT_BYTES)))).toEqual([CORE_REF]);
        expect(provide).toHaveBeenCalledTimes(1);
        expect(warn).not.toHaveBeenCalled();

        // На символ больше — не гоняем и пишем, что и почему пропустили.
        expect(await host.provideReferences(requestOf("x".repeat(MAX_TEXT_BYTES + 1)))).toEqual([]);
        expect(provide).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith("skipping references: document too large", {
            uri: "file:///a.ts",
            length: MAX_TEXT_BYTES + 1,
        });
    });

    it("после остановки субпроцесса подписка сброшена — запрос не уходит до новой", async () => {
        const { host, peer } = makeHost();
        const provide = vi.fn(() => Promise.resolve([REF]));
        peer.handleRequest("languages.provideReferences", provide);
        peer.notify("languages.updateSubscriptions", { hasReferenceProviders: true });
        await flushMicrotasks();
        expect(await host.provideReferences(requestOf("x"))).toEqual([CORE_REF]);

        await (host as unknown as { shutdownSubprocess(): Promise<void> }).shutdownSubprocess();

        expect(await host.provideReferences(requestOf("x"))).toEqual([]);
        expect(provide).toHaveBeenCalledTimes(1);
    });

    it("дефолт таймаута — 5000 мс: поиск ссылок по проекту дороже одиночного перехода", () => {
        const { host } = makeHost();
        // Читаем разрешённую опцию, а не ждём вживую: реальное ожидание в
        // мутационном прогоне стоит полсекунды на каждом покрывающем мутанте.
        expect((host as unknown as { options: { referencesTimeoutMs: number } }).options.referencesTimeoutMs).toBe(
            5000,
        );
    });

    it("по истечении таймаута ответ отбрасывается", async () => {
        const { host, peer } = makeHost({ referencesTimeoutMs: 5 });
        peer.handleRequest("languages.provideReferences", async () => {
            await settle(200);
            return [REF];
        });
        peer.notify("languages.updateSubscriptions", { hasReferenceProviders: true });
        await flushMicrotasks();

        expect(await host.provideReferences(requestOf("x"))).toEqual([]);
    });
});
