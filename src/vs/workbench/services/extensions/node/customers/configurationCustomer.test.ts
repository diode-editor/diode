import { describe, expect, it } from "vitest";

import { flushMicrotasks } from "../../../../../../TestUtils/timing.ts";
import { Emitter } from "../../../../../base/common/event.ts";
import { Uri } from "../../../../../base/common/uri.ts";
import { ConfigurationRegistry } from "../../../../../platform/configuration/common/configurationRegistry.ts";
import { InMemoryConfigurationService } from "../../../../../platform/configuration/common/inMemoryConfigurationService.ts";
import { createInProcessChannelPair } from "../../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";
import type { IExtensionHostConfigProvider, IWorkspaceFolderInfo } from "../extensionHost.ts";

import { ConfigurationCustomer } from "./configurationCustomer.ts";

function setup() {
    const changes = new Emitter<readonly string[]>();
    let version = 0;
    const provider = {
        getSnapshot: () => ({ version }),
        getWorkspaceFolders: () => [{ uri: "file:///ws", name: "ws", index: 0 }],
        onDidChange: (cb: (keys: readonly string[]) => void) => changes.event(cb),
    } as unknown as IExtensionHostConfigProvider;
    const customer = new ConfigurationCustomer(provider);
    const [a, b] = createInProcessChannelPair();
    const peer = new RpcEndpoint(b);
    const log: unknown[] = [];
    for (const method of ["workspace.initialize", "workspace.configurationChanged"]) {
        peer.handleNotification(method, (params) => log.push([method, params]));
    }
    const attachTo = () => customer.attach({ rpc: new RpcEndpoint(a), logger: undefined });
    return {
        customer,
        changes,
        log,
        attachTo,
        bump: () => {
            version++;
        },
    };
}

describe("ConfigurationCustomer", () => {
    it("семя workspace.initialize — снимок и папки, только живому спавну", async () => {
        const h = setup();
        h.customer.pushInitialState();
        const attached = h.attachTo();
        h.customer.pushInitialState();
        await flushMicrotasks();
        expect(h.log).toEqual([
            [
                "workspace.initialize",
                { configuration: { version: 0 }, workspaceFolders: [{ uri: "file:///ws", name: "ws", index: 0 }] },
            ],
        ]);

        attached.dispose();
        h.customer.pushInitialState();
        await flushMicrotasks();
        expect(h.log).toHaveLength(1);
    });

    it("смена настроек уходит свежим снимком с ключами; после ухода спавна — никому", async () => {
        const h = setup();
        const attached = h.attachTo();
        h.bump();
        h.changes.fire(["editor.tabSize"]);
        await flushMicrotasks();
        expect(h.log).toEqual([
            ["workspace.configurationChanged", { configuration: { version: 1 }, affectedKeys: ["editor.tabSize"] }],
        ]);

        attached.dispose();
        h.changes.fire(["editor.tabSize"]);
        await flushMicrotasks();
        expect(h.log).toHaveLength(1);
    });
});

/**
 * Запись `configuration.update` поверх настоящего сервиса в памяти: реестр с
 * ключами всех скоупов, одна папка (или пустое окно). `peer` — сторона
 * субпроцесса; `order` — что и в каком порядке до неё дошло.
 */
function setupWrite(options: { folders?: readonly IWorkspaceFolderInfo[] } = {}) {
    const registry = new ConfigurationRegistry();
    registry.registerExtensionConfiguration("t.ext", {
        "t.window": { default: 1, scope: "window" },
        "t.resource": { default: 1, scope: "resource" },
        "t.machineOverridable": { default: 1, scope: "machine-overridable" },
        "t.app": { default: 1, scope: "application" },
        "t.machine": { default: 1, scope: "machine" },
    });
    const folders = options.folders ?? [{ uri: Uri.file("/ws").toString(), name: "ws", index: 0 }];
    const service = new InMemoryConfigurationService(registry, {}, folders.length === 0 ? undefined : {});
    const provider: IExtensionHostConfigProvider = {
        getSnapshot: () => service.getConfigurationData(),
        getWorkspaceFolders: () => folders,
        onDidChange: (cb) =>
            service.onDidChangeConfiguration((event) => {
                cb(event.affectedKeys);
            }),
        updateValue: (key, value, target) => service.updateValue(key, value, target),
        getConfigurationScopes: () => registry.getConfigurationScopes(),
    };
    const customer = new ConfigurationCustomer(provider);
    const [a, b] = createInProcessChannelPair();
    const peer = new RpcEndpoint(b);
    const order: unknown[] = [];
    peer.handleNotification("workspace.configurationChanged", (params) => {
        order.push(["configurationChanged", (params as { affectedKeys: unknown }).affectedKeys]);
    });
    customer.attach({ rpc: new RpcEndpoint(a), logger: undefined });
    const update = async (params: unknown): Promise<void> => {
        await peer.request("configuration.update", params);
        order.push("response");
    };
    return { service, update, order };
}

describe("ConfigurationCustomer — configuration.update", () => {
    it("без цели пишет в воркспейс; configurationChanged доходит раньше ответа", async () => {
        const h = setupWrite();
        await h.update({ key: "t.window", value: 5 });
        expect(h.service.inspect("t.window")).toMatchObject({ workspace: 5, user: undefined, value: 5 });
        expect(h.order).toEqual([["configurationChanged", ["t.window"]], "response"]);
    });

    it("цель user — в user-слой; без value — ключ снимается", async () => {
        const h = setupWrite();
        await h.update({ key: "t.app", value: 7, target: "user" });
        expect(h.service.inspect("t.app")).toMatchObject({ user: 7, workspace: undefined });
        await h.update({ key: "t.app", target: "user" });
        expect(h.service.inspect("t.app").user).toBeUndefined();
    });

    it("неизвестный ключ — отказ ERROR_UNKNOWN_KEY с именем цели; снятие и секция языка — можно", async () => {
        const h = setupWrite();
        await expect(h.update({ key: "t.nope", value: 1 })).rejects.toThrow(
            "Unable to write to Workspace Settings because t.nope is not a registered configuration.",
        );
        await expect(h.update({ key: "t.nope", value: 1, target: "user" })).rejects.toThrow(
            "Unable to write to User Settings because t.nope is not a registered configuration.",
        );
        await expect(
            h.update({ key: "t.nope", value: 1, target: "workspaceFolder", resource: Uri.file("/ws").toString() }),
        ).rejects.toThrow("Unable to write to Folder Settings because t.nope is not a registered configuration.");
        await h.update({ key: "t.nope", target: "user" });
        await h.update({ key: "[go]", value: { "editor.tabSize": 8 }, target: "user" });
        expect(h.service.getConfigurationData().user).toMatchObject({ "[go]": { editor: { tabSize: 8 } } });
    });

    it("application/machine в воркспейс — отказ сервиса доходит текстом эталона", async () => {
        const h = setupWrite();
        await expect(h.update({ key: "t.machine", value: 2 })).rejects.toThrow(
            "Unable to write t.machine to Workspace Settings. This setting can be written only into User settings.",
        );
        expect(h.order).toEqual([]);
    });

    it("пустое окно: без цели и в воркспейс — no workspace is opened; в папку — то же про Folder Settings", async () => {
        const h = setupWrite({ folders: [] });
        await expect(h.update({ key: "t.window", value: 2 })).rejects.toThrow(
            "Unable to write to Workspace Settings because no workspace is opened.",
        );
        await expect(
            h.update({ key: "t.window", value: 2, target: "workspaceFolder", resource: Uri.file("/x").toString() }),
        ).rejects.toThrow(
            "Unable to write to Folder Settings because no workspace is opened. Please open a workspace first and try again.",
        );
        await h.update({ key: "t.window", value: 2, target: "user" });
        expect(h.service.inspect("t.window").user).toBe(2);
    });

    it("цель-папка: ресурс внутри папки пишет в тот же файл воркспейса", async () => {
        const h = setupWrite();
        await h.update({
            key: "t.resource",
            value: 3,
            target: "workspaceFolder",
            resource: Uri.file("/ws/src/a.ts").toString(),
        });
        await h.update({
            key: "t.machineOverridable",
            value: 4,
            target: "workspaceFolder",
            resource: Uri.file("/ws").toString(),
        });
        expect(h.service.getConfigurationData().workspace).toMatchObject({ t: { resource: 3, machineOverridable: 4 } });
    });

    it.each([
        ["без ресурса", undefined],
        ["ресурс вне папки", Uri.file("/other/a.ts").toString()],
        ["соседний каталог с тем же префиксом", Uri.file("/ws2/a.ts").toString()],
        ["другая схема", "untitled:/ws/a.ts"],
    ])("цель-папка %s — no resource is provided", async (_name, resource) => {
        const h = setupWrite();
        await expect(
            h.update({
                key: "t.resource",
                value: 3,
                target: "workspaceFolder",
                ...(resource !== undefined ? { resource } : {}),
            }),
        ).rejects.toThrow("Unable to write to Folder Settings because no resource is provided.");
        expect(h.service.getConfigurationData().workspace).toEqual({});
    });

    it.each(["t.window", "t.app", "t.machine"])("цель-папка: %s вне FOLDER_SCOPES — отказ", async (key) => {
        const h = setupWrite();
        await expect(
            h.update({ key, value: 3, target: "workspaceFolder", resource: Uri.file("/ws").toString() }),
        ).rejects.toThrow(
            `Unable to write to Folder Settings because ${key} does not support the folder resource scope.`,
        );
    });

    it("битый конверт — отказ, сервис не тронут", async () => {
        const h = setupWrite();
        await expect(h.update({ value: 1 })).rejects.toThrow("configuration.update: expected");
        await expect(h.update({ key: "t.window", value: 1, target: "memory" })).rejects.toThrow(
            "configuration.update: expected",
        );
        expect(h.service.getConfigurationData().workspace).toEqual({});
    });
});
