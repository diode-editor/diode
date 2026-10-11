import { describe, expect, it, vi } from "vitest";

import { Uri } from "../../../base/common/uri.ts";

import { WorkspaceContextService } from "./workspaceContextService.ts";
import { computeWorkspaceId } from "./workspaceId.ts";

describe("WorkspaceContextService", () => {
    describe("пустое окно", () => {
        it("папок нет, идентичности нет, состояние empty", () => {
            const service = new WorkspaceContextService();
            expect(service.getWorkspace()).toEqual({ id: null, folders: [] });
            expect(service.getWorkbenchState()).toBe("empty");
        });

        // Без папки «внутри воркспейса» не лежит ничего — в том числе файл,
        // который человек открыл аргументом командной строки.
        it("getWorkspaceFolder на любой файл — null", () => {
            expect(new WorkspaceContextService().getWorkspaceFolder(Uri.file("/any/file.ts"))).toBeNull();
        });
    });

    describe("setWorkspaceFolder", () => {
        it("ставит ровно одну папку с uri, именем-basename и индексом 0", () => {
            const service = new WorkspaceContextService();
            service.setWorkspaceFolder("/work/my project");

            const { folders } = service.getWorkspace();
            expect(folders.length).toBe(1);
            expect(folders[0]?.name).toBe("my project");
            expect(folders[0]?.index).toBe(0);
            // Uri, а не голый путь: пробел обязан уехать в percent-encoding.
            expect(folders[0]?.uri.toString()).toBe("file:///work/my%20project");
            expect(folders[0]?.uri.fsPath).toBe("/work/my project");
        });

        it("переводит состояние окна в folder", () => {
            const service = new WorkspaceContextService();
            service.setWorkspaceFolder("/work/project");
            expect(service.getWorkbenchState()).toBe("folder");
        });

        it("идентичность — computeWorkspaceId от той же папки, и её же возвращает вызов", () => {
            const service = new WorkspaceContextService();
            const returned = service.setWorkspaceFolder("/work/project");
            expect(returned).toBe(computeWorkspaceId("/work/project"));
            expect(service.getWorkspace().id).toBe(returned);
        });

        // Путь резолвится в абсолютный ОДИН раз: и папка, и id обязаны считаться
        // от одного и того же пути, иначе `diode .` и `diode /abs` разъедутся.
        it("резолвит относительный путь — и в папке, и в идентичности", () => {
            const service = new WorkspaceContextService();
            const id = service.setWorkspaceFolder("sub/dir");
            expect(service.getWorkspace().folders[0]?.uri.fsPath).toBe(`${process.cwd()}/sub/dir`);
            expect(id).toBe(computeWorkspaceId(`${process.cwd()}/sub/dir`));
        });

        it("повторный вызов заменяет папку, а не добавляет вторую", () => {
            const service = new WorkspaceContextService();
            service.setWorkspaceFolder("/work/first");
            service.setWorkspaceFolder("/work/second");

            const { folders, id } = service.getWorkspace();
            expect(folders.map((f) => f.name)).toEqual(["second"]);
            expect(id).toBe(computeWorkspaceId("/work/second"));
        });
    });

    describe("setWorkspaceFile", () => {
        it("папка — из файла, состояние workspace, файл — в configuration", () => {
            const service = new WorkspaceContextService();
            service.setWorkspaceFile("/repo/web.code-workspace", { folder: "/repo", folderName: undefined });

            const workspace = service.getWorkspace();
            expect(service.getWorkbenchState()).toBe("workspace");
            expect(workspace.configuration?.fsPath).toBe("/repo/web.code-workspace");
            expect(workspace.folders.map((f) => [f.uri.fsPath, f.name, f.index])).toEqual([["/repo", "repo", 0]]);
        });

        it("name из файла — имя папки", () => {
            const service = new WorkspaceContextService();
            service.setWorkspaceFile("/repo/web.code-workspace", { folder: "/repo", folderName: "Web" });
            expect(service.getWorkspace().folders[0]?.name).toBe("Web");
        });

        // Ради этого файлы воркспейса и заводятся: у двух файлов над одним
        // каталогом — свои вкладки и раскладка, и обе отличны от самой папки.
        it("идентичность — от пути файла: два файла над одной папкой и сама папка — три проекта", () => {
            const service = new WorkspaceContextService();
            const web = service.setWorkspaceFile("/repo/web.code-workspace", {
                folder: "/repo",
                folderName: undefined,
            });
            expect(web).toBe(computeWorkspaceId("/repo/web.code-workspace"));
            expect(service.getWorkspace().id).toBe(web);

            const backend = service.setWorkspaceFile("/repo/backend.code-workspace", {
                folder: "/repo",
                folderName: undefined,
            });
            const folder = service.setWorkspaceFolder("/repo");
            expect(new Set([web, backend, folder]).size).toBe(3);
        });

        it("резолвит относительные пути файла и папки", () => {
            const service = new WorkspaceContextService();
            const id = service.setWorkspaceFile("ws/web.code-workspace", { folder: "ws", folderName: undefined });
            expect(service.getWorkspace().configuration?.fsPath).toBe(`${process.cwd()}/ws/web.code-workspace`);
            expect(service.getWorkspace().folders[0]?.uri.fsPath).toBe(`${process.cwd()}/ws`);
            expect(id).toBe(computeWorkspaceId(`${process.cwd()}/ws/web.code-workspace`));
        });

        it("оповещает подписчиков, а Open Folder после него возвращает состояние folder", () => {
            const service = new WorkspaceContextService();
            const listener = vi.fn();
            service.onDidChangeWorkspaceFolders(listener);

            service.setWorkspaceFile("/repo/web.code-workspace", { folder: "/repo", folderName: undefined });
            expect(listener).toHaveBeenCalledTimes(1);

            service.setWorkspaceFolder("/repo");
            expect(service.getWorkbenchState()).toBe("folder");
            expect(service.getWorkspace().configuration).toBeUndefined();
        });
    });

    describe("getWorkspaceFolder", () => {
        function opened(): WorkspaceContextService {
            const service = new WorkspaceContextService();
            service.setWorkspaceFolder("/work/project");
            return service;
        }

        it("файл внутри папки — эта папка", () => {
            expect(opened().getWorkspaceFolder(Uri.file("/work/project/src/x.ts"))?.name).toBe("project");
        });

        it("сама папка считается лежащей внутри себя", () => {
            expect(opened().getWorkspaceFolder(Uri.file("/work/project"))?.name).toBe("project");
        });

        // Матч по границе сегмента, а не по строковому префиксу: иначе соседний
        // `/work/project-old` уехал бы в тот же воркспейс.
        it("сосед с общим префиксом имени — null", () => {
            expect(opened().getWorkspaceFolder(Uri.file("/work/project-old/x.ts"))).toBeNull();
        });

        it("файл вне папки — null", () => {
            expect(opened().getWorkspaceFolder(Uri.file("/elsewhere/x.ts"))).toBeNull();
        });

        // Ресурс от расширения (`jdt:`, `git:`) в папку на диске не попадает,
        // даже если его путь текстуально совпал.
        it("другая схема — null даже при совпадающем пути", () => {
            expect(opened().getWorkspaceFolder(Uri.parse("git:/work/project/src/x.ts"))).toBeNull();
        });

        // Корень ФС — единственная папка, чей путь сам кончается на `/`:
        // приклеенный разделитель дал бы `//` и выкинул из воркспейса всё.
        it("папка-корень `/` вмещает любой файл", () => {
            const service = new WorkspaceContextService();
            service.setWorkspaceFolder("/");
            expect(service.getWorkspaceFolder(Uri.file("/etc/hosts"))?.index).toBe(0);
            expect(service.getWorkspaceFolder(Uri.file("/"))?.index).toBe(0);
        });
    });

    describe("onDidChangeWorkspaceFolders", () => {
        it("стреляет на смене набора папок", () => {
            const service = new WorkspaceContextService();
            const listener = vi.fn();
            service.onDidChangeWorkspaceFolders(listener);

            service.setWorkspaceFolder("/work/project");
            expect(listener).toHaveBeenCalledTimes(1);
            service.setWorkspaceFolder("/work/other");
            expect(listener).toHaveBeenCalledTimes(2);
        });

        // Подписчик обязан видеть УЖЕ новое состояние: на этом событии висит
        // активация расширений по `workspaceContains:`.
        it("на момент вызова слушателя папка уже новая", () => {
            const service = new WorkspaceContextService();
            const seen: (string | undefined)[] = [];
            service.onDidChangeWorkspaceFolders(() => {
                seen.push(service.getWorkspace().folders.at(0)?.name);
            });

            service.setWorkspaceFolder("/work/project");
            expect(seen).toEqual(["project"]);
        });

        it("немедленно после подписки не вызывается", () => {
            const service = new WorkspaceContextService();
            service.setWorkspaceFolder("/work/project");

            const listener = vi.fn();
            service.onDidChangeWorkspaceFolders(listener);
            expect(listener).not.toHaveBeenCalled();
        });

        it("dispose отписывает", () => {
            const service = new WorkspaceContextService();
            const listener = vi.fn();
            service.onDidChangeWorkspaceFolders(listener).dispose();

            service.setWorkspaceFolder("/work/project");
            expect(listener).not.toHaveBeenCalled();
        });

        // Слушатели обходятся по копии набора: отписка изнутри обработчика
        // (её делает, например, одноразовый подписчик) не должна пропускать соседа.
        it("отписка изнутри обработчика не съедает соседних слушателей", () => {
            const service = new WorkspaceContextService();
            const second = vi.fn();
            const first = vi.fn(() => {
                subscription.dispose();
            });
            const subscription = service.onDidChangeWorkspaceFolders(first);
            service.onDidChangeWorkspaceFolders(second);

            service.setWorkspaceFolder("/work/project");
            expect(first).toHaveBeenCalledTimes(1);
            expect(second).toHaveBeenCalledTimes(1);
        });
    });
});
