import { describe, expect, it } from "vitest";

import {
    hasWorkspaceFileExtension,
    type IWorkspaceFileReader,
    loadWorkspaceFile,
    parseWorkspaceFile,
    WorkspaceFileError,
    workspaceFileLabel,
} from "./workspaceFile.ts";

const FILE = "/repo/web.code-workspace";

function parse(content: unknown): ReturnType<typeof parseWorkspaceFile> {
    return parseWorkspaceFile(typeof content === "string" ? content : JSON.stringify(content), FILE);
}

function failure(content: unknown): string {
    try {
        parse(content);
    } catch (err) {
        expect(err).toBeInstanceOf(WorkspaceFileError);
        return (err as Error).message;
    }
    throw new Error("parse did not fail");
}

describe("parseWorkspaceFile", () => {
    // Главный сценарий: файлы воркспейса лежат в корне монорепы и смотрят на неё
    // же — `"."` считается от каталога ФАЙЛА, а не от cwd процесса.
    it("относительный path — от каталога файла", () => {
        expect(parse({ folders: [{ path: "." }] }).folder).toBe("/repo");
        expect(parse({ folders: [{ path: "packages/web" }] }).folder).toBe("/repo/packages/web");
        expect(parse({ folders: [{ path: "../other" }] }).folder).toBe("/other");
    });

    it("абсолютный path берётся как есть (нормализованным)", () => {
        expect(parse({ folders: [{ path: "/abs/dir/" }] }).folder).toBe("/abs/dir");
    });

    it("папку можно назвать file-uri, как в эталоне", () => {
        expect(parse({ folders: [{ uri: "file:///abs/my%20dir" }] }).folder).toBe("/abs/my dir");
    });

    it("name папки — её отображаемое имя; пустой или не строка — имени нет", () => {
        expect(parse({ folders: [{ path: ".", name: "Web" }] }).folderName).toBe("Web");
        expect(parse({ folders: [{ path: "." }] }).folderName).toBeUndefined();
        expect(parse({ folders: [{ path: ".", name: "" }] }).folderName).toBeUndefined();
        expect(parse({ folders: [{ path: ".", name: 1 }] }).folderName).toBeUndefined();
    });

    it("JSONC: комментарии и висячая запятая", () => {
        const text = `{
            // папка монорепы
            "folders": [{ "path": "." },],
            "settings": { "editor.tabSize": 2, },
        }`;
        expect(parse(text).folder).toBe("/repo");
    });

    it("битый JSON — отказ с путём файла и местом ошибки", () => {
        expect(failure('{ "folders": [ }')).toMatch(
            /^Invalid workspace file \/repo\/web\.code-workspace: \w+ at offset \d+$/,
        );
    });

    it("без папок — отказ", () => {
        const expected = "Workspace file /repo/web.code-workspace has no folders";
        expect(failure({})).toBe(expected);
        expect(failure({ folders: [] })).toBe(expected);
        expect(failure({ folders: "." })).toBe(expected);
        expect(failure("[]")).toBe(expected);
        expect(failure("null")).toBe(expected);
        expect(failure("1")).toBe(expected);
    });

    // Мульти-рута нет: молча взять первую папку значило бы открыть не то, что
    // человек ждёт, — поэтому отказ с объяснением.
    it("больше одной папки — отказ «мульти-рут не поддержан»", () => {
        expect(failure({ folders: [{ path: "a" }, { path: "b" }] })).toBe(
            "Workspace file /repo/web.code-workspace lists 2 folders: multi-root workspaces are not supported yet, a workspace file must have exactly one folder",
        );
    });

    it("запись папки без path и без file-uri — отказ", () => {
        const expected = 'Workspace file /repo/web.code-workspace: a folder entry must have a "path" or a file "uri"';
        expect(failure({ folders: [{}] })).toBe(expected);
        expect(failure({ folders: [{ path: "" }] })).toBe(expected);
        expect(failure({ folders: [{ uri: "vscode-remote://host/dir" }] })).toBe(expected);
        expect(failure({ folders: [{ uri: 1 }] })).toBe(expected);
        expect(failure({ folders: ["."] })).toBe(expected);
        expect(failure({ folders: [null] })).toBe(expected);
    });
});

describe("loadWorkspaceFile", () => {
    function reader(files: Record<string, string>, dirs: readonly string[]): IWorkspaceFileReader {
        return {
            readText: (filePath) =>
                filePath in files ? Promise.resolve(files[filePath]) : Promise.reject(new Error("ENOENT")),
            isDirectory: (filePath) => Promise.resolve(dirs.includes(filePath)),
        };
    }

    it("читает, разбирает и проверяет, что папка есть", async () => {
        const contents = await loadWorkspaceFile(
            FILE,
            reader({ [FILE]: '{ "folders": [{ "path": "." }] }' }, ["/repo"]),
        );
        expect(contents).toEqual({ folder: "/repo", folderName: undefined });
    });

    it("файла нет — отказ с путём", async () => {
        await expect(loadWorkspaceFile(FILE, reader({}, []))).rejects.toThrow(
            new WorkspaceFileError("Workspace file does not exist or cannot be read: /repo/web.code-workspace"),
        );
    });

    it("папки из файла нет на диске — отказ с обоими путями", async () => {
        const files = { [FILE]: '{ "folders": [{ "path": "gone" }] }' };
        await expect(loadWorkspaceFile(FILE, reader(files, ["/repo"]))).rejects.toThrow(
            new WorkspaceFileError("Workspace folder does not exist: /repo/gone (from /repo/web.code-workspace)"),
        );
    });

    it("отказ разбора доходит как есть", async () => {
        await expect(loadWorkspaceFile(FILE, reader({ [FILE]: "{}" }, ["/repo"]))).rejects.toBeInstanceOf(
            WorkspaceFileError,
        );
    });
});

describe("hasWorkspaceFileExtension", () => {
    it("узнаёт файл воркспейса по расширению", () => {
        expect(hasWorkspaceFileExtension("/repo/web.code-workspace")).toBe(true);
        expect(hasWorkspaceFileExtension("web.code-workspace")).toBe(true);
        expect(hasWorkspaceFileExtension("/repo/web.json")).toBe(false);
        expect(hasWorkspaceFileExtension("/repo/code-workspace")).toBe(false);
        expect(hasWorkspaceFileExtension("/repo/web.code-workspace.bak")).toBe(false);
    });
});

describe("workspaceFileLabel", () => {
    it("базовое имя без расширения", () => {
        expect(workspaceFileLabel("/repo/web.code-workspace")).toBe("web");
        expect(workspaceFileLabel("/repo/my.app.code-workspace")).toBe("my.app");
    });
});
