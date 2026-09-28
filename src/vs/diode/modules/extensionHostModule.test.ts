import { describe, expect, it } from "vitest";

import { workspaceFoldersProvider } from "./extensionHostModule.ts";

/** Источник корня, которым можно подвигать папку между вызовами провайдера. */
function explorerWithRoot(root: string | null): { getRootPath: () => string | null; root: string | null } {
    const source = { root, getRootPath: () => source.root };
    return source;
}

describe("workspaceFoldersProvider", () => {
    it("папка открыта — одна запись с uri, именем и индексом 0", () => {
        expect(workspaceFoldersProvider(explorerWithRoot("/work/project"))()).toEqual([
            { uri: "file:///work/project", name: "project", index: 0 },
        ]);
    });

    it("имя — basename, а не весь путь", () => {
        expect(workspaceFoldersProvider(explorerWithRoot("/a/b/c/deep"))()[0]?.name).toBe("deep");
    });

    it("uri — настоящий file-uri, а не голый путь", () => {
        // Пробел обязан уехать в percent-encoding: подстановка пути «как есть»
        // дала бы расширению неразбираемый uri.
        expect(workspaceFoldersProvider(explorerWithRoot("/work/my project"))()[0]?.uri).toBe(
            "file:///work/my%20project",
        );
    });

    // Главный инвариант пустого окна: никакого process.cwd() под видом
    // воркспейса — иначе git и прочие уходят шерстить каталог запуска.
    it("папки нет — ПУСТОЙ список, а не подставленный cwd", () => {
        const folders = workspaceFoldersProvider(explorerWithRoot(null))();
        expect(folders).toEqual([]);
        expect(JSON.stringify(folders)).not.toContain(process.cwd());
    });

    // Вторая половина контракта: корень читается на КАЖДЫЙ вызов. Снимок,
    // взятый в момент биндинга, залипал бы на «папки нет» — extension host
    // спрашивает папки уже после setWorkspaceFolder, а Open Folder меняет их
    // и вовсе в рантайме.
    it("читает корень на каждый вызов, а не запоминает его при создании", () => {
        const explorer = explorerWithRoot(null);
        const getFolders = workspaceFoldersProvider(explorer);
        expect(getFolders()).toEqual([]);

        explorer.root = "/work/opened-later";
        expect(getFolders()).toEqual([{ uri: "file:///work/opened-later", name: "opened-later", index: 0 }]);

        explorer.root = "/work/another";
        expect(getFolders()[0]?.name).toBe("another");
    });
});
