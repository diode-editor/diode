import { tmpdir } from "node:os";
import * as path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { WorkspaceContextService } from "../../platform/workspace/common/workspaceContextService.ts";
import { ExtensionHostDIToken } from "../../workbench/services/extensions/node/extensionHost.ts";
import { LifecycleServiceDIToken } from "../../workbench/services/lifecycle/browser/lifecycleService.ts";

import { extensionHostModule, workspaceFoldersProvider } from "./extensionHostModule.ts";
import { createTestContainer } from "./testProfile.ts";

/**
 * Проводка extension host'а в прощание: продовый модуль поверх тестового
 * контейнера. Субпроцесс не поднимается (расширений нет) — проверяем, что
 * прощание вообще доходит до host'а: снятый host больше не принимает
 * регистраций. Порядок и тайм-аут закрыты юнитами `LifecycleService`, вежливый
 * выход и добивание субпроцесса — юнитами `ExtensionHost`.
 */
describe("extensionHostModule — прощание", () => {
    it("shutdown снимает extension host", async () => {
        const { container } = createTestContainer();
        const dir = path.join(tmpdir(), "diode-exthost-module-test");
        container.use(extensionHostModule, {
            globalStorageDir: dir,
            workspaceStorageDir: dir,
            logsDir: dir,
            secretsFile: path.join(dir, "secrets.json"),
        });
        const host = container.get(ExtensionHostDIToken);
        const lifecycle = container.get(LifecycleServiceDIToken);
        const shutdown = vi.spyOn(host, "shutdown");
        const disposeNow = vi.spyOn(host, "disposeNow");
        // Подписан позже host'а — в синхронной фазе срабатывает раньше него:
        // к этому моменту host уже снят вежливо, в асинхронной фазе.
        let shutdownBeforeSyncPhase = false;
        lifecycle.onShutdownSync(() => {
            shutdownBeforeSyncPhase = shutdown.mock.calls.length === 1;
        });

        await lifecycle.shutdown("quit", () => undefined);

        expect(shutdownBeforeSyncPhase).toBe(true);
        // Синхронная фаза добивает субпроцесс, если вежливое прощание не успело.
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

/**
 * Источник папок — настоящий `WorkspaceContextService` (он без зависимостей, так
 * что заглушка была бы дороже правды): `setWorkspaceFolder` двигает папку между
 * вызовами провайдера, свежий экземпляр — пустое окно.
 */
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
        // Пробел обязан уехать в percent-encoding: подстановка пути «как есть»
        // дала бы расширению неразбираемый uri.
        expect(workspaceFoldersProvider(workspaceWithFolder("/work/my project"))()[0]?.uri).toBe(
            "file:///work/my%20project",
        );
    });

    // Главный инвариант пустого окна: никакого process.cwd() под видом
    // воркспейса — иначе git и прочие уходят шерстить каталог запуска.
    it("папки нет — ПУСТОЙ список, а не подставленный cwd", () => {
        const folders = workspaceFoldersProvider(workspaceWithFolder(null))();
        expect(folders).toEqual([]);
        expect(JSON.stringify(folders)).not.toContain(process.cwd());
    });

    // Вторая половина контракта: папки читаются на КАЖДЫЙ вызов. Снимок,
    // взятый в момент биндинга, залипал бы на «папки нет» — extension host
    // спрашивает папки уже после setWorkspaceFolder, а Open Folder меняет их
    // и вовсе в рантайме.
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
