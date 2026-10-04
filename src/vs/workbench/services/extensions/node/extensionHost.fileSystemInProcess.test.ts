import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";

import { ExtensionHost } from "./extensionHost.ts";

/**
 * Детерминированный in-process тест хендлеров провайдеров ФС: вместо форка
 * субпроцесса гоняем `installHostHandlers` на in-process RPC-паре и шлём
 * нотификации сами. Так пробиваются guard-ветки на структурно чужие параметры,
 * которые честный субпроцесс никогда не пришлёт (образец —
 * `extensionHost.decorationsInProcess.test.ts`).
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
    // readProvidedFile подставляем ту же пару вручную.
    const attachRpc = () => {
        (host as unknown as { rpc: RpcEndpoint | null }).rpc = hostRpc;
    };
    return { host, peer, attachRpc };
}

describe("ExtensionHost — нотификации провайдеров ФС (in-process)", () => {
    it("список схем обновляется и будит подписчиков", async () => {
        const { host, peer } = makeHost();
        const seen = vi.fn();
        host.onFileSystemProvidersChanged(seen);

        peer.notify("workspace.fileSystemProvidersChanged", { schemes: ["git", "output"] });
        await flushMicrotasks();

        expect(host.getFileSystemSchemes()).toEqual(["git", "output"]);
        expect(seen).toHaveBeenCalledTimes(1);
    });

    it("нестроковые схемы отфильтровываются, не-массив даёт пустой список", async () => {
        const { host, peer } = makeHost();

        peer.notify("workspace.fileSystemProvidersChanged", { schemes: ["git", 42, null] });
        await flushMicrotasks();
        expect(host.getFileSystemSchemes()).toEqual(["git"]);

        peer.notify("workspace.fileSystemProvidersChanged", { schemes: "не массив" });
        await flushMicrotasks();
        expect(host.getFileSystemSchemes()).toEqual([]);
    });

    it("отписка от смены схем работает", async () => {
        const { host, peer } = makeHost();
        const seen = vi.fn();
        host.onFileSystemProvidersChanged(seen).dispose();

        peer.notify("workspace.fileSystemProvidersChanged", { schemes: ["git"] });
        await flushMicrotasks();

        expect(seen).not.toHaveBeenCalled();
    });

    it("изменения ресурсов доходят до подписчиков", async () => {
        const { host, peer } = makeHost();
        const seen: string[] = [];
        host.onDidChangeProvidedFile((uris) => {
            for (const uri of uris) seen.push(uri.toString());
        });

        peer.notify("workspace.fs.didChangeFile", { uris: ["git:/a.ts", "git:/b.ts"] });
        await flushMicrotasks();

        expect(seen).toEqual(["git:/a.ts", "git:/b.ts"]);
    });

    it("пустой и структурно чужой список изменений подписчиков не будит", async () => {
        const { host, peer } = makeHost();
        const seen = vi.fn();
        host.onDidChangeProvidedFile(seen);

        peer.notify("workspace.fs.didChangeFile", { uris: [] });
        peer.notify("workspace.fs.didChangeFile", { uris: "не массив" });
        peer.notify("workspace.fs.didChangeFile", { uris: [42] });
        await flushMicrotasks();

        expect(seen).not.toHaveBeenCalled();
    });

    it("отписка от изменений ресурсов работает", async () => {
        const { host, peer } = makeHost();
        const seen = vi.fn();
        host.onDidChangeProvidedFile(seen).dispose();

        peer.notify("workspace.fs.didChangeFile", { uris: ["git:/a.ts"] });
        await flushMicrotasks();

        expect(seen).not.toHaveBeenCalled();
    });

    it("повторный dispose подписок безопасен", () => {
        // Идемпотентность: владелец может звать dispose и сам, и через Disposable-набор.
        const { host } = makeHost();
        const schemes = host.onFileSystemProvidersChanged(() => undefined);
        const files = host.onDidChangeProvidedFile(() => undefined);

        schemes.dispose();
        files.dispose();

        expect(() => {
            schemes.dispose();
            files.dispose();
        }).not.toThrow();
    });

    it("readProvidedFile без поднятого host'а отклоняется", async () => {
        // Спавн к хосту не подключался — канала к провайдерам нет.
        const host = new ExtensionHost(NOOP_EDITOR_OPTIONS, NOOP_COMMANDS, {});

        await expect(host.readProvidedFile(Uri.parse("git:/a.ts"))).rejects.toThrow(/extension host is not running/);
    });

    it("readProvidedFile уходит запросом в субпроцесс и разбирает ответ", async () => {
        const { host, peer, attachRpc } = makeHost();
        attachRpc();
        peer.handleRequest("workspace.fs.readFile", (params) => {
            expect(params).toEqual({ uri: "git:/a.ts" });
            return { content: Buffer.from("оригинал", "utf8").toString("base64") };
        });

        const bytes = await host.readProvidedFile(Uri.parse("git:/a.ts"));

        expect(new TextDecoder().decode(bytes)).toBe("оригинал");
    });
});
