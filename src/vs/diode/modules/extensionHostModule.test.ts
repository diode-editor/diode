import { describe, expect, it } from "vitest";

import { WorkspaceContextService } from "../../platform/workspace/common/workspaceContextService.ts";

import { workspaceFoldersProvider } from "./extensionHostModule.ts";

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
