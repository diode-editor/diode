import { describe, expect, it, vi } from "vitest";

import type { IFoldingRequest } from "../../../../editor/common/languages/iFoldingSource.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";

import { ExtensionHost } from "./extensionHost.ts";

/**
 * Folding по handle: субпроцесса нет, канал сшит in-process — так видно, что
 * вызовы прокси с одним запросом уходят одной пачкой (пересчёт фолдов идёт на
 * каждую правку, и полный текст не должен множиться на число провайдеров) и
 * что остановка субпроцесса отрезает запросы.
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
    (host as unknown as { rpc: RpcEndpoint }).rpc = hostRpc;
    return { host, peer };
}

const REQUEST: IFoldingRequest = { uri: "file:///a.cs", languageId: "csharp", text: "a\nb\nc\nd\n" };

describe("ExtensionHost — folding по handle (in-process)", () => {
    it("вызовы прокси с одним запросом — один RPC с пачкой handle; области — по своим", async () => {
        const { host, peer } = makeHost();
        const provide = vi.fn((_params: unknown) => Promise.resolve([[{ start: 0, end: 2 }], [{ start: 1, end: 3 }]]));
        peer.handleRequest("languages.provideFoldingRanges", provide);

        const [first, second] = await Promise.all([
            host.provideFoldingRanges(2, REQUEST),
            host.provideFoldingRanges(6, REQUEST),
        ]);

        expect(provide).toHaveBeenCalledTimes(1);
        expect(provide.mock.calls[0]?.[0]).toEqual({ handles: [2, 6], ...REQUEST });
        expect(first).toEqual([{ startLine: 0, endLine: 2, isCollapsed: false }]);
        expect(second).toEqual([{ startLine: 1, endLine: 3, isCollapsed: false }]);
    });

    it("после остановки субпроцесса запрос не уходит", async () => {
        const { host, peer } = makeHost();
        const provide = vi.fn(() => Promise.resolve([[{ start: 0, end: 2 }]]));
        peer.handleRequest("languages.provideFoldingRanges", provide);

        await (host as unknown as { shutdownSubprocess(): Promise<void> }).shutdownSubprocess();

        expect(await host.provideFoldingRanges(0, REQUEST)).toEqual([]);
        expect(provide).not.toHaveBeenCalled();
    });
});
