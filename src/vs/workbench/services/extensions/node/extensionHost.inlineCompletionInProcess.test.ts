import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { CancellationTokenSource, type ICancellationToken } from "../../../../base/common/cancellation.ts";
import { InlineCompletionTriggerKind } from "../../../../editor/common/languages/iInlineCompletionSource.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";

import { ExtensionHost } from "./extensionHost.ts";

/**
 * Guard-ветки подписки inline completions: флаг `hasInlineCompletionProviders`
 * гейтит RPC целиком, чужая форма флага читается как false (образец —
 * `extensionHost.completionInProcess.test.ts`).
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

const REQ = {
    uri: "file:///proj/main.ts",
    languageId: "typescript",
    text: "con",
    line: 0,
    character: 3,
    triggerKind: InlineCompletionTriggerKind.Invoke,
};

function makeHost(): { host: ExtensionHost; peer: RpcEndpoint } {
    const host = new ExtensionHost(NOOP_EDITOR_OPTIONS, NOOP_COMMANDS, {});
    const [a, b] = createInProcessChannelPair();
    const hostRpc = new RpcEndpoint(a);
    const peer = new RpcEndpoint(b);
    (host as unknown as { installHostHandlers(rpc: RpcEndpoint): void }).installHostHandlers(hostRpc);
    (host as unknown as { rpc: RpcEndpoint }).rpc = hostRpc;
    return { host, peer };
}

describe("ExtensionHost — inline completions (in-process)", () => {
    it("без подписки RPC не уходит; подписка открывает путь, параметры уезжают как есть", async () => {
        const { host, peer } = makeHost();
        const seen = vi.fn((params: unknown) => {
            void params;
            return [{ insertText: " = 42;" }];
        });
        peer.handleRequest("languages.provideInlineCompletions", seen);

        expect(await host.provideInlineCompletions(REQ)).toEqual([]);
        expect(seen).not.toHaveBeenCalled();

        peer.notify("languages.updateSubscriptions", { hasInlineCompletionProviders: true });
        await flushMicrotasks();
        expect(await host.provideInlineCompletions(REQ)).toEqual([{ insertText: " = 42;" }]);
        // Параметры как есть + токен отмены этого запроса (второй аргумент
        // хендлера — его выдаёт RpcEndpoint принимающей стороны).
        expect(seen).toHaveBeenCalledExactlyOnceWith(REQ, expect.objectContaining({ isCancellationRequested: false }));
    });

    it("чужая форма флага читается как false, снятие подписки закрывает путь", async () => {
        const { host, peer } = makeHost();
        const seen = vi.fn(() => [{ insertText: "x" }]);
        peer.handleRequest("languages.provideInlineCompletions", seen);

        peer.notify("languages.updateSubscriptions", { hasInlineCompletionProviders: "yes" });
        await flushMicrotasks();
        expect(await host.provideInlineCompletions(REQ)).toEqual([]);

        peer.notify("languages.updateSubscriptions", { hasInlineCompletionProviders: true });
        await flushMicrotasks();
        expect(await host.provideInlineCompletions(REQ)).toEqual([{ insertText: "x" }]);

        peer.notify("languages.updateSubscriptions", { hasInlineCompletionProviders: false });
        await flushMicrotasks();
        expect(await host.provideInlineCompletions(REQ)).toEqual([]);
        expect(seen).toHaveBeenCalledTimes(1);
    });

    it("отмена ядра доезжает до токена субпроцесса и снимает работу провайдера", async () => {
        const { host, peer } = makeHost();
        let seen: ICancellationToken | null = null;
        let release: (value: unknown) => void = () => undefined;
        peer.handleRequest("languages.provideInlineCompletions", (_params, token) => {
            seen = token;
            return new Promise((resolve) => {
                release = resolve;
            });
        });
        peer.notify("languages.updateSubscriptions", { hasInlineCompletionProviders: true });
        await flushMicrotasks();

        const source = new CancellationTokenSource();
        const pending = host.provideInlineCompletions(REQ, source.token);
        await flushMicrotasks();
        expect(seen!.isCancellationRequested).toBe(false);

        source.cancel();
        await flushMicrotasks();
        expect(seen!.isCancellationRequested).toBe(true);

        release([{ insertText: "late" }]);
        // Ответ отменённого запроса extension-слой не глушит — его отбрасывает
        // ядро (InlineCompletionsService), здесь мост просто отдаёт что пришло.
        expect(await pending).toEqual([{ insertText: "late" }]);
    });

    it("истёкший таймаут отменяет запрос у субпроцесса", async () => {
        const host = new ExtensionHost(NOOP_EDITOR_OPTIONS, NOOP_COMMANDS, { inlineCompletionTimeoutMs: 20 });
        const [a, b] = createInProcessChannelPair();
        const hostRpc = new RpcEndpoint(a);
        const peer = new RpcEndpoint(b);
        (host as unknown as { installHostHandlers(rpc: RpcEndpoint): void }).installHostHandlers(hostRpc);
        (host as unknown as { rpc: RpcEndpoint }).rpc = hostRpc;

        let seen: ICancellationToken | null = null;
        peer.handleRequest("languages.provideInlineCompletions", (_params, token) => {
            seen = token;
            return new Promise(() => undefined);
        });
        peer.notify("languages.updateSubscriptions", { hasInlineCompletionProviders: true });
        await flushMicrotasks();

        expect(await host.provideInlineCompletions(REQ)).toEqual([]);
        await flushMicrotasks();
        // Молчащий провайдер узнаёт, что его ответа больше не ждут.
        expect(seen!.isCancellationRequested).toBe(true);
    });

    it("мусорный ответ субпроцесса — пустой список (drop+skip на пунктах)", async () => {
        const { host, peer } = makeHost();
        peer.handleRequest("languages.provideInlineCompletions", () => ({ items: "junk" }));
        peer.notify("languages.updateSubscriptions", { hasInlineCompletionProviders: true });
        await flushMicrotasks();

        expect(await host.provideInlineCompletions(REQ)).toEqual([]);
    });
});
