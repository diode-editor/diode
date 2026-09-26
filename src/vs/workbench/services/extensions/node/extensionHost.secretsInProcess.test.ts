import { describe, expect, it } from "vitest";

import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";

import { ExtensionHost } from "./extensionHost.ts";
import { createInMemoryExtensionSecretStore, type IExtensionSecretStore } from "./extensionSecretsStore.ts";

// Детерминированный in-process тест хостовых хендлеров `secrets.*`: на живом
// субпроцессе битую форму запроса не послать (её собирает наш же namespace), а
// проверить отказ надо — это граница доверия хоста (паттерн
// extensionHost.statusBarInProcess.test.ts).

const NOOP_EDITOR_OPTIONS = {
    getActiveEditorOptions: () => null,
    setActiveEditorOptions: () => undefined,
    getActiveEditorFilePath: () => null,
    getActiveEditorMeta: () => ({ uri: null, languageId: null, isDirty: false }),
    onActiveEditorChanged: () => ({ dispose: () => undefined }),
    onActiveEditorSelectionChanged: () => ({ dispose: () => undefined }),
    setActiveEditorSelections: () => undefined,
    applyActiveEditorEdits: () => true,
} as unknown as IEditorOptionsService;

const NOOP_COMMANDS = {
    execute: () => undefined,
    registerProxy: () => ({ dispose: () => undefined }),
} as unknown as ICommandService;

function makeHost(): { host: ExtensionHost; peer: RpcEndpoint; secrets: IExtensionSecretStore; changed: unknown[] } {
    const secrets = createInMemoryExtensionSecretStore();
    const host = new ExtensionHost(NOOP_EDITOR_OPTIONS, NOOP_COMMANDS, { secrets });
    const [a, b] = createInProcessChannelPair();
    const hostRpc = new RpcEndpoint(a);
    const peer = new RpcEndpoint(b);
    (host as unknown as { installHostHandlers(rpc: RpcEndpoint): void }).installHostHandlers(hostRpc);
    const changed: unknown[] = [];
    peer.handleNotification("secrets.changed", (params) => changed.push(params));
    return { host, peer, secrets, changed };
}

describe("ExtensionHost — хендлеры secrets.* (in-process)", () => {
    it("store кладёт в хранилище и оповещает субпроцесс", async () => {
        const h = makeHost();
        await h.peer.request("secrets.store", { extensionId: "pub.one", key: "token", value: "s3cr3t" });
        expect(h.secrets.get("pub.one", "token")).toBe("s3cr3t");
        expect(h.changed).toEqual([{ extensionId: "pub.one", key: "token" }]);
        h.host.dispose();
    });

    it("get отдаёт значение, а отсутствие — как `null` (undefined через JSON не ездит)", async () => {
        const h = makeHost();
        expect(await h.peer.request("secrets.get", { extensionId: "pub.one", key: "token" })).toEqual({ value: null });
        h.secrets.store("pub.one", "token", "s3cr3t");
        expect(await h.peer.request("secrets.get", { extensionId: "pub.one", key: "token" })).toEqual({
            value: "s3cr3t",
        });
        h.host.dispose();
    });

    it("delete убирает секрет и тоже оповещает", async () => {
        const h = makeHost();
        h.secrets.store("pub.one", "token", "s3cr3t");
        await h.peer.request("secrets.delete", { extensionId: "pub.one", key: "token" });
        expect(h.secrets.get("pub.one", "token")).toBeUndefined();
        expect(h.changed).toEqual([{ extensionId: "pub.one", key: "token" }]);
        h.host.dispose();
    });

    it("keys отдаёт ключи расширения", async () => {
        const h = makeHost();
        h.secrets.store("pub.one", "token", "a");
        h.secrets.store("pub.two", "other", "b");
        expect(await h.peer.request("secrets.keys", { extensionId: "pub.one" })).toEqual({ keys: ["token"] });
        h.host.dispose();
    });

    it.each([
        ["secrets.get", {}],
        ["secrets.delete", { extensionId: "pub.one" }],
        ["secrets.store", { extensionId: "pub.one", key: "token" }],
        ["secrets.keys", { extensionId: "" }],
    ])("битая форма %s отклоняется, а не молча проглатывается", async (method, params) => {
        const h = makeHost();
        await expect(h.peer.request(method, params)).rejects.toThrow(new RegExp(method));
        h.host.dispose();
    });

    it("отказ по форме не оповещает субпроцесс об изменении", async () => {
        const h = makeHost();
        await expect(h.peer.request("secrets.store", { extensionId: "pub.one", key: "token" })).rejects.toThrow();
        expect(h.changed).toEqual([]);
        h.host.dispose();
    });

    it("сообщение об отказе не содержит значения секрета", async () => {
        // Иначе оно уехало бы в лог RPC вместе с текстом ошибки.
        const h = makeHost();
        await expect(
            h.peer.request("secrets.store", { extensionId: "pub.one", key: 1, value: "s3cr3t" }),
        ).rejects.toThrow(expect.not.stringContaining("s3cr3t") as unknown as string);
        h.host.dispose();
    });
});
