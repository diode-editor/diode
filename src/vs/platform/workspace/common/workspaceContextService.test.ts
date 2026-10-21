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
            // A Uri, not a bare path: the space must become percent-encoded.
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

        // The path is resolved to absolute ONCE: both the folder and the id must come
        // from the same path, otherwise `diode .` and `diode /abs` would diverge.
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

        // This is why workspace files exist: two files over one directory have
        // their own tabs and layout, and both differ from the folder itself.
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

        // Match on a segment boundary, not a string prefix: otherwise the sibling
        // `/work/project-old` would land in the same workspace.
        it("сосед с общим префиксом имени — null", () => {
            expect(opened().getWorkspaceFolder(Uri.file("/work/project-old/x.ts"))).toBeNull();
        });

        it("файл вне папки — null", () => {
            expect(opened().getWorkspaceFolder(Uri.file("/elsewhere/x.ts"))).toBeNull();
        });

        // An extension resource (`jdt:`, `git:`) doesn't belong to an on-disk folder,
        // even if its path matches textually.
        it("другая схема — null даже при совпадающем пути", () => {
            expect(opened().getWorkspaceFolder(Uri.parse("git:/work/project/src/x.ts"))).toBeNull();
        });

        // The FS root is the only folder whose path itself ends with `/`:
        // appending a separator would give `//` and drop everything from the workspace.
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

        // The subscriber must ALREADY see the new state: `workspaceContains:`
        // extension activation hangs off this event.
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

        // Listeners are iterated over a copy of the set: unsubscribing from inside a handler
        // (as a one-shot subscriber does) must not skip the next one.
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
