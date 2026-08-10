import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";

import { ExtensionHost } from "./extensionHost.ts";

/**
 * Guard-ветки подписки на completion: честный субпроцесс всегда шлёт массив
 * строк, поэтому чужую форму параметров пробиваем in-process нотификациями
 * (образец — `extensionHost.fileSystemInProcess.test.ts`).
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

function makeHost(): { host: ExtensionHost; peer: RpcEndpoint } {
    const host = new ExtensionHost(NOOP_EDITOR_OPTIONS, NOOP_COMMANDS, {});
    const [a, b] = createInProcessChannelPair();
    const hostRpc = new RpcEndpoint(a);
    const peer = new RpcEndpoint(b);
    (host as unknown as { installHostHandlers(rpc: RpcEndpoint): void }).installHostHandlers(hostRpc);
    return { host, peer };
}

describe("ExtensionHost — триггер-символы completion (in-process)", () => {
    it("нестроковые символы отфильтровываются, не-массив даёт пустой список", async () => {
        const { host, peer } = makeHost();
        const seen = vi.fn();
        host.onCompletionTriggerCharactersChanged(seen);

        peer.notify("languages.updateSubscriptions", {
            hasCompletionProviders: true,
            completionTriggerCharacters: [".", 42, null, '"'],
        });
        await flushMicrotasks();
        expect(host.completionTriggerCharacters).toEqual([".", '"']);
        expect(seen).toHaveBeenCalledTimes(1);

        // Поле отсутствует вовсе (подписка без completion-провайдеров).
        peer.notify("languages.updateSubscriptions", { hasCompletionProviders: false });
        await flushMicrotasks();
        expect(host.completionTriggerCharacters).toEqual([]);
        expect(seen).toHaveBeenCalledTimes(2);
    });

    it("тот же набор символов подписчиков не будит", async () => {
        const { host, peer } = makeHost();
        const seen = vi.fn();
        host.onCompletionTriggerCharactersChanged(seen);

        peer.notify("languages.updateSubscriptions", {
            hasCompletionProviders: true,
            completionTriggerCharacters: ["."],
        });
        await flushMicrotasks();
        peer.notify("languages.updateSubscriptions", {
            hasCompletionProviders: true,
            completionTriggerCharacters: ["."],
        });
        await flushMicrotasks();

        expect(seen).toHaveBeenCalledTimes(1);
    });
});
