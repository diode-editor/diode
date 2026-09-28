import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";

import { ExtensionHost } from "./extensionHost.ts";

/**
 * Детерминированный in-process тест хендлеров провайдеров содержимого: вместо
 * форка субпроцесса гоняем `installHostHandlers` на in-process RPC-паре и шлём
 * нотификации сами. Так пробиваются guard-ветки на структурно чужие параметры,
 * которые честный субпроцесс никогда не пришлёт (образец —
 * `extensionHost.fileSystemInProcess.test.ts`).
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

function makeHost() {
    const host = new ExtensionHost(NOOP_EDITOR_OPTIONS, NOOP_COMMANDS, {});
    const [a, b] = createInProcessChannelPair();
    const hostRpc = new RpcEndpoint(a);
    const peer = new RpcEndpoint(b);
    (host as unknown as { installHostHandlers(rpc: RpcEndpoint): void }).installHostHandlers(hostRpc);
    // installHostHandlers не выставляет this.rpc (это делает spawn) — для
    // provideTextDocumentContent подставляем ту же пару вручную.
    const attachRpc = () => {
        (host as unknown as { rpc: RpcEndpoint | null }).rpc = hostRpc;
    };
    return { host, peer, attachRpc };
}

describe("ExtensionHost — провайдеры содержимого недисковых ресурсов (in-process)", () => {
    it("список схем обновляется по нотификации субпроцесса", async () => {
        const { host, peer } = makeHost();

        peer.notify("workspace.textDocumentContentProvidersChanged", { schemes: ["jdt", "class"] });
        await flushMicrotasks();

        expect(host.hasTextContentProvider("jdt")).toBe(true);
        expect(host.hasTextContentProvider("class")).toBe(true);
        expect(host.hasTextContentProvider("git")).toBe(false);
    });

    it("нестроковые схемы отфильтровываются, не-массив даёт пустой список", async () => {
        const { host, peer } = makeHost();

        peer.notify("workspace.textDocumentContentProvidersChanged", { schemes: ["jdt", 42, null] });
        await flushMicrotasks();
        expect(host.hasTextContentProvider("jdt")).toBe(true);

        peer.notify("workspace.textDocumentContentProvidersChanged", { schemes: "не массив" });
        await flushMicrotasks();
        expect(host.hasTextContentProvider("jdt")).toBe(false);
    });

    it("сообщение об изменении ресурса доходит до подписчиков", async () => {
        const { host, peer } = makeHost();
        const seen: string[] = [];
        host.onDidChangeTextContent((uri) => seen.push(uri.toString()));

        peer.notify("workspace.textDocumentContentChanged", { uri: "jdt:/Foo.java" });
        await flushMicrotasks();

        expect(seen).toEqual(["jdt:/Foo.java"]);
    });

    it("структурно чужое сообщение об изменении подписчиков не будит", async () => {
        const { host, peer } = makeHost();
        const seen = vi.fn();
        host.onDidChangeTextContent(seen);

        peer.notify("workspace.textDocumentContentChanged", {});
        peer.notify("workspace.textDocumentContentChanged", { uri: 42 });
        await flushMicrotasks();

        expect(seen).not.toHaveBeenCalled();
    });

    it("отписка от изменений содержимого работает", async () => {
        const { host, peer } = makeHost();
        const seen = vi.fn();
        host.onDidChangeTextContent(seen).dispose();

        peer.notify("workspace.textDocumentContentChanged", { uri: "jdt:/Foo.java" });
        await flushMicrotasks();

        expect(seen).not.toHaveBeenCalled();
    });

    it("повторный dispose подписки — no-op", async () => {
        const { host, peer } = makeHost();
        const seen = vi.fn();
        const subscription = host.onDidChangeTextContent(seen);
        subscription.dispose();
        subscription.dispose();

        peer.notify("workspace.textDocumentContentChanged", { uri: "jdt:/Foo.java" });
        await flushMicrotasks();

        expect(seen).not.toHaveBeenCalled();
    });

    it("без субпроцесса запрос содержимого отклоняется, а не молчит", async () => {
        const { host } = makeHost();

        await expect(host.provideTextDocumentContent(Uri.parse("jdt:/Foo.java"))).rejects.toThrow(
            "extension host is not running",
        );
    });

    it("ответ субпроцесса разбирается: строка, null и структурный мусор", async () => {
        const { host, peer, attachRpc } = makeHost();
        attachRpc();
        let reply: unknown = { content: "class Foo {}" };
        peer.handleRequest("workspace.provideTextDocumentContent", () => reply);

        expect(await host.provideTextDocumentContent(Uri.parse("jdt:/Foo.java"))).toBe("class Foo {}");

        reply = { content: null };
        expect(await host.provideTextDocumentContent(Uri.parse("jdt:/Foo.java"))).toBeNull();

        reply = { content: 42 };
        await expect(host.provideTextDocumentContent(Uri.parse("jdt:/Foo.java"))).rejects.toThrow(
            /must be a string or null/u,
        );
    });
});
