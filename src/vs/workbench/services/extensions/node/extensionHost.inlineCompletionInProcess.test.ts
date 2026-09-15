import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";
import { InlineCompletionTriggerKind } from "../../../../editor/common/languages/iInlineCompletionSource.ts";

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
        expect(seen).toHaveBeenCalledExactlyOnceWith(REQ);
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

    it("мусорный ответ субпроцесса — пустой список (drop+skip на пунктах)", async () => {
        const { host, peer } = makeHost();
        peer.handleRequest("languages.provideInlineCompletions", () => ({ items: "junk" }));
        peer.notify("languages.updateSubscriptions", { hasInlineCompletionProviders: true });
        await flushMicrotasks();

        expect(await host.provideInlineCompletions(REQ)).toEqual([]);
    });
});
