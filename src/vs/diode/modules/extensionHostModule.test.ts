import { tmpdir } from "node:os";
import * as path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { ConfigurationRegistry } from "../../platform/configuration/common/configurationRegistry.ts";
import { InMemoryConfigurationService } from "../../platform/configuration/common/inMemoryConfigurationService.ts";
import { WorkspaceContextService } from "../../platform/workspace/common/workspaceContextService.ts";
import { ExtensionHostDIToken } from "../../workbench/services/extensions/node/extensionHost.ts";
import { LifecycleServiceDIToken } from "../../workbench/services/lifecycle/browser/lifecycleService.ts";

import { extensionHostConfigProvider, extensionHostModule, workspaceFoldersProvider } from "./extensionHostModule.ts";
import { createTestContainer } from "./testProfile.ts";

/** No subprocess is spawned (no extensions): checks that shutdown reaches the host at all. */
describe("extensionHostModule — прощание", () => {
    it("shutdown снимает extension host", async () => {
        const { container } = createTestContainer();
        const dir = path.join(tmpdir(), "diode-exthost-module-test");
        container.use(extensionHostModule, {
            extensions: [],
            registration: {
                userPrefix: "UserExtensions/",
                userExtensionsDir: dir,
                readBuiltinSource: () => Promise.resolve(""),
            },
        });
        const host = container.get(ExtensionHostDIToken);
        const lifecycle = container.get(LifecycleServiceDIToken);
        const shutdown = vi.spyOn(host, "shutdown");
        const disposeNow = vi.spyOn(host, "disposeNow");
        // Subscribed after the host, so it fires before it in the sync phase:
        // by then the host is already shut down gracefully in the async phase.
        let shutdownBeforeSyncPhase = false;
        lifecycle.onShutdownSync(() => {
            shutdownBeforeSyncPhase = shutdown.mock.calls.length === 1;
        });

        await lifecycle.shutdown("quit", () => undefined);

        expect(shutdownBeforeSyncPhase).toBe(true);
        expect(disposeNow).toHaveBeenCalledOnce();
        expect(() => {
            host.registerExtension({
                id: "a.b",
                manifest: { name: "b", publisher: "a", version: "1.0.0" },
                source: "",
                filename: "/a.js",
            });
        }).toThrow(/disposed/);
    });
});

/** Real `WorkspaceContextService`: it has no dependencies, so a stub would cost more than the real thing. */
function workspaceWithFolder(root: string | null): WorkspaceContextService {
    const service = new WorkspaceContextService();
    if (root !== null) service.setWorkspaceFolder(root);
    return service;
}

describe("workspaceFoldersProvider", () => {
    it("папка открыта — одна запись с uri, именем и индексом 0", () => {
        expect(workspaceFoldersProvider(workspaceWithFolder("/work/project"))()).toEqual([
            { uri: "file:///work/project", name: "project", index: 0 },
        ]);
    });

    it("имя — basename, а не весь путь", () => {
        expect(workspaceFoldersProvider(workspaceWithFolder("/a/b/c/deep"))()[0]?.name).toBe("deep");
    });

    it("uri — настоящий file-uri, а не голый путь", () => {
        // A raw path would give the extension an unparsable uri.
        expect(workspaceFoldersProvider(workspaceWithFolder("/work/my project"))()[0]?.uri).toBe(
            "file:///work/my%20project",
        );
    });

    it("папки нет — ПУСТОЙ список, а не подставленный cwd", () => {
        const folders = workspaceFoldersProvider(workspaceWithFolder(null))();
        expect(folders).toEqual([]);
        expect(JSON.stringify(folders)).not.toContain(process.cwd());
    });

    it("читает папки на каждый вызов, а не запоминает их при создании", () => {
        const workspace = workspaceWithFolder(null);
        const getFolders = workspaceFoldersProvider(workspace);
        expect(getFolders()).toEqual([]);

        workspace.setWorkspaceFolder("/work/opened-later");
        expect(getFolders()).toEqual([{ uri: "file:///work/opened-later", name: "opened-later", index: 0 }]);

        workspace.setWorkspaceFolder("/work/another");
        expect(getFolders()[0]?.name).toBe("another");
    });
});

describe("extensionHostConfigProvider", () => {
    function setup() {
        const registry = new ConfigurationRegistry();
        registry.registerExtensionConfiguration("t.ext", { "t.flag": { default: true, scope: "application" } });
        const service = new InMemoryConfigurationService(registry, { "t.flag": false }, {});
        const provider = extensionHostConfigProvider(service, registry, workspaceWithFolder("/work/project"));
        return { service, provider };
    }

    it("слои, папки и scope реестра — из сервисов ядра", () => {
        const { provider } = setup();
        expect(provider.getSnapshot()).toMatchObject({ defaults: { t: { flag: true } }, user: { t: { flag: false } } });
        expect(provider.getWorkspaceFolders()).toEqual([{ uri: "file:///work/project", name: "project", index: 0 }]);
        expect(provider.getConfigurationScopes().get("t.flag")).toBe("application");
    });

    it("файл воркспейса — uri файла окна из .code-workspace, у окна из папки — нет", () => {
        const workspace = workspaceWithFolder("/work/project");
        const provider = extensionHostConfigProvider(
            new InMemoryConfigurationService(),
            new ConfigurationRegistry(),
            workspace,
        );
        expect(provider.getWorkspaceFile()).toBeUndefined();

        workspace.setWorkspaceFile("/work/project/web.code-workspace", {
            folder: "/work/project",
            folderName: undefined,
        });
        expect(provider.getWorkspaceFile()).toBe("file:///work/project/web.code-workspace");
    });

    it("запись идёт в сервис ядра с целью, его отказ доходит, событие — ключами", async () => {
        const { service, provider } = setup();
        const changes: (readonly string[])[] = [];
        provider.onDidChange((keys) => changes.push(keys));
        await provider.updateValue("t.flag", true, "user");
        expect(service.inspect("t.flag").user).toBe(true);
        expect(changes).toEqual([["t.flag"]]);
        await expect(provider.updateValue("t.flag", true, "workspace")).rejects.toThrow(
            "can be written only into User settings",
        );
    });
});
