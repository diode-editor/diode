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

function setup(workspaceFile?: string) {
    const changes = new Emitter<readonly string[]>();
    let version = 0;
    const provider = {
        getSnapshot: () => ({ version }),
        getWorkspaceFolders: () => [{ uri: "file:///ws", name: "ws", index: 0 }],
        getWorkspaceFile: () => workspaceFile,
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
    it("workspace.initialize seed — snapshot and folders, only to a live spawn", async () => {
        const h = setup();
        h.customer.pushInitialState();
        const attached = h.attachTo();
        h.customer.pushInitialState();
        await flushMicrotasks();
        // Strict: a folder window has no workspaceFile field in the seed at all.
        expect(h.log).toStrictEqual([
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

    it("window from .code-workspace: the seed also carries the workspace file", async () => {
        const h = setup("file:///ws/web.code-workspace");
        h.attachTo();
        h.customer.pushInitialState();
        await flushMicrotasks();
        expect(h.log).toEqual([
            [
                "workspace.initialize",
                {
                    configuration: { version: 0 },
                    workspaceFolders: [{ uri: "file:///ws", name: "ws", index: 0 }],
                    workspaceFile: "file:///ws/web.code-workspace",
                },
            ],
        ]);
    });

    it("a settings change goes out as a fresh snapshot with keys; after the spawn exits — to no one", async () => {
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

function setupWrite(options: { folders?: readonly IWorkspaceFolderInfo[]; workspaceFile?: string } = {}) {
    const registry = new ConfigurationRegistry();
    registry.registerExtensionConfiguration("t.ext", {
        "t.window": { default: 1, scope: "window" },
        "t.resource": { default: 1, scope: "resource" },
        "t.lang": { default: 1, scope: "language-overridable" },
        "t.machineOverridable": { default: 1, scope: "machine-overridable" },
        "t.app": { default: 1, scope: "application" },
        "t.machine": { default: 1, scope: "machine" },
    });
    const folders = options.folders ?? [{ uri: Uri.file("/ws").toString(), name: "ws", index: 0 }];
    const service = new InMemoryConfigurationService(registry, {}, folders.length === 0 ? undefined : {});
    const targets: string[] = [];
    const provider: IExtensionHostConfigProvider = {
        getSnapshot: () => service.getConfigurationData(),
        getWorkspaceFolders: () => folders,
        getWorkspaceFile: () => options.workspaceFile,
        onDidChange: (cb) =>
            service.onDidChangeConfiguration((event) => {
                cb(event.affectedKeys);
            }),
        updateValue: (key, value, target) => {
            targets.push(target);
            return service.updateValue(key, value, target);
        },
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
    return { service, update, order, targets };
}

describe("ConfigurationCustomer — configuration.update", () => {
    it("without a target writes to the workspace; configurationChanged arrives before the reply", async () => {
        const h = setupWrite();
        await h.update({ key: "t.window", value: 5 });
        expect(h.service.inspect("t.window")).toMatchObject({ workspace: 5, user: undefined, value: 5 });
        expect(h.order).toEqual([["configurationChanged", ["t.window"]], "response"]);
    });

    it("target user — into the user layer; without value — the key is removed", async () => {
        const h = setupWrite();
        await h.update({ key: "t.app", value: 7, target: "user" });
        expect(h.service.inspect("t.app")).toMatchObject({ user: 7, workspace: undefined });
        await h.update({ key: "t.app", target: "user" });
        expect(h.service.inspect("t.app").user).toBeUndefined();
    });

    it("unknown key — ERROR_UNKNOWN_KEY rejection with the target name; removal and a language section are allowed", async () => {
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

    it("application/machine to the workspace — the service rejection arrives with the upstream text", async () => {
        const h = setupWrite();
        await expect(h.update({ key: "t.machine", value: 2 })).rejects.toThrow(
            "Unable to write t.machine to Workspace Settings. This setting can be written only into User settings.",
        );
        expect(h.order).toEqual([]);
    });

    it("empty window: no target and workspace — no workspace is opened; folder — the same about Folder Settings", async () => {
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

    it("folder target: removing an unregistered key succeeds (no scope — nothing to check)", async () => {
        const h = setupWrite();
        await h.update({ key: "t.nope", target: "workspaceFolder", resource: Uri.file("/ws").toString() });
        expect(h.order).toEqual(["response"]);
    });

    it("folder target: the resource is looked up in all folders, not only the first", async () => {
        const h = setupWrite({
            folders: [
                { uri: Uri.file("/first").toString(), name: "first", index: 0 },
                { uri: Uri.file("/ws").toString(), name: "ws", index: 1 },
            ],
        });
        await h.update({
            key: "t.resource",
            value: 3,
            target: "workspaceFolder",
            resource: Uri.file("/ws/a.ts").toString(),
        });
        expect(h.service.getConfigurationData().workspace).toMatchObject({ t: { resource: 3 } });
    });

    it("window from .code-workspace: no target, resource/language-overridable with a resource — into the folder", async () => {
        const h = setupWrite({ workspaceFile: Uri.file("/ws/web.code-workspace").toString() });
        const resource = Uri.file("/ws/a.ts").toString();

        await h.update({ key: "t.resource", value: 1, resource });
        await h.update({ key: "t.lang", value: 2, resource });
        await h.update({ key: "t.window", value: 3, resource });
        await h.update({ key: "t.resource", value: 4 });

        expect(h.targets).toEqual(["workspaceFolder", "workspaceFolder", "workspace", "workspace"]);
    });

    it("window from a folder: no target — always the workspace, even with a resource", async () => {
        const h = setupWrite();
        await h.update({ key: "t.resource", value: 1, resource: Uri.file("/ws/a.ts").toString() });
        expect(h.targets).toEqual(["workspace"]);
    });

    it("an explicit folder target reaches the service as is", async () => {
        const h = setupWrite();
        await h.update({
            key: "t.resource",
            value: 1,
            target: "workspaceFolder",
            resource: Uri.file("/ws").toString(),
        });
        expect(h.targets).toEqual(["workspaceFolder"]);
    });

    it("folder target: a resource inside the folder writes to the same workspace file", async () => {
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
        ["without a resource", undefined],
        ["resource outside the folder", Uri.file("/other/a.ts").toString()],
        ["sibling directory with the same prefix", Uri.file("/ws2/a.ts").toString()],
        ["another scheme", "untitled:/ws/a.ts"],
    ])("folder target %s — no resource is provided", async (_name, resource) => {
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

    it.each(["t.window", "t.app", "t.machine"])("folder target: %s outside FOLDER_SCOPES — rejected", async (key) => {
        const h = setupWrite();
        await expect(
            h.update({ key, value: 3, target: "workspaceFolder", resource: Uri.file("/ws").toString() }),
        ).rejects.toThrow(
            `Unable to write to Folder Settings because ${key} does not support the folder resource scope.`,
        );
    });

    it("broken envelope — rejected, the service is untouched", async () => {
        const h = setupWrite();
        await expect(h.update({ value: 1 })).rejects.toThrow("configuration.update: expected");
        await expect(h.update({ key: "t.window", value: 1, target: "memory" })).rejects.toThrow(
            "configuration.update: expected",
        );
        expect(h.service.getConfigurationData().workspace).toEqual({});
    });
});
