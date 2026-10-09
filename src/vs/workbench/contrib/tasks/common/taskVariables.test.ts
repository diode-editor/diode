import * as paths from "node:path";

import { describe, expect, it } from "vitest";

import { type ITaskVariableContext, resolveVariables, TaskVariableError } from "./taskVariables.ts";

// Подстановка переменных задачи (`variableResolver.ts` эталона): значения,
// тексты отказов эталона, неизвестная переменная остаётся как есть.

function context(overrides: Partial<ITaskVariableContext> = {}): ITaskVariableContext {
    return {
        folderPath: "/ws/proj",
        filePath: "/ws/proj/src/app.test.ts",
        lineNumber: 7,
        env: { HOME: "/home/u", EMPTY: "" },
        userHome: "/home/u",
        cwd: "/proc/cwd",
        getConfiguration: (key) => ({ "a.str": "s", "a.num": 3, "a.obj": { x: 1 }, "a.null": null })[key],
        ...overrides,
    };
}

const resolve = (value: string, overrides?: Partial<ITaskVariableContext>): string =>
    resolveVariables(value, context(overrides));

describe("resolveVariables — значения", () => {
    it("папка воркспейса и её имя (с устаревшими синонимами)", () => {
        expect(resolve("${workspaceFolder}|${workspaceRoot}")).toBe("/ws/proj|/ws/proj");
        expect(resolve("${workspaceFolderBasename}|${workspaceRootFolderName}")).toBe("proj|proj");
        expect(resolve("${workspaceFolder:proj}")).toBe("/ws/proj");
        expect(resolve("${workspaceFolder:}")).toBe("/ws/proj");
    });

    it("файл активного редактора и его части", () => {
        expect(resolve("${file}")).toBe("/ws/proj/src/app.test.ts");
        expect(resolve("${fileBasename}")).toBe("app.test.ts");
        expect(resolve("${fileBasenameNoExtension}")).toBe("app.test");
        expect(resolve("${fileExtname}")).toBe(".ts");
        expect(resolve("${fileDirname}")).toBe("/ws/proj/src");
        expect(resolve("${relativeFile}")).toBe(paths.join("src", "app.test.ts"));
        expect(resolve("${relativeFileDirname}")).toBe("src");
        expect(resolve("${lineNumber}")).toBe("7");
    });

    it("файл в корне папки — относительный каталог «.»; без папки — абсолютные пути", () => {
        expect(resolve("${relativeFileDirname}", { filePath: "/ws/proj/x.ts" })).toBe(".");
        expect(resolve("${relativeFile}|${relativeFileDirname}", { folderPath: undefined })).toBe(
            "/ws/proj/src/app.test.ts|/ws/proj/src",
        );
    });

    it("окружение: значение, пустое — пусто, нет переменной — пусто", () => {
        expect(resolve("${env:HOME}|${env:EMPTY}|${env:NOPE}")).toBe("/home/u||");
    });

    it("настройки: строка как есть, число — текстом", () => {
        expect(resolve("${config:a.str}/${config:a.num}")).toBe("s/3");
        // В карту подстановок (определение в событии старта) уходит тоже текст.
        const resolved = new Map<string, string>();
        resolveVariables("${config:a.num}", context(), resolved);
        expect(resolved.get("${config:a.num}")).toBe("3");
    });

    it("cwd: с папкой — папка (как у эталона), без папки — каталог процесса", () => {
        expect(resolve("${cwd}")).toBe("/ws/proj");
        expect(resolve("${cwd}", { folderPath: undefined })).toBe("/proc/cwd");
    });

    it("домашний каталог, разделитель пути", () => {
        expect(resolve("${userHome}")).toBe("/home/u");
        expect(resolve("${pathSeparator}${/}")).toBe(`${paths.sep}${paths.sep}`);
    });

    it("неизвестная переменная и текст без переменных — как есть; несколько в строке", () => {
        expect(resolve("${foo} ${workspaceFolder} $x {y}")).toBe("${foo} /ws/proj $x {y}");
    });

    it("собирает подставленное в карту, неизменённое — нет", () => {
        const resolved = new Map<string, string>();
        resolveVariables("${workspaceFolder} ${foo} ${env:EMPTY}", context(), resolved);
        expect([...resolved]).toStrictEqual([
            ["${workspaceFolder}", "/ws/proj"],
            ["${env:EMPTY}", ""],
        ]);
    });
});

describe("resolveVariables — отказы (тексты эталона)", () => {
    const fails = (value: string, message: string, overrides?: Partial<ITaskVariableContext>): void => {
        expect(() => resolve(value, overrides)).toThrow(new TaskVariableError(message));
    };

    it("нет редактора — переменные файла", () => {
        for (const name of [
            "file",
            "fileBasename",
            "fileBasenameNoExtension",
            "fileExtname",
            "fileDirname",
            "relativeFile",
            "relativeFileDirname",
        ]) {
            fails(`\${${name}}`, `Variable \${${name}} can not be resolved. Please open an editor.`, {
                filePath: undefined,
            });
        }
    });

    it("нет папки — переменные папки; чужое имя папки", () => {
        fails("${workspaceFolder}", "Variable workspaceFolder can not be resolved. Please open a folder.", {
            folderPath: undefined,
        });
        fails(
            "${workspaceFolderBasename}",
            "Variable workspaceFolderBasename can not be resolved. Please open a folder.",
            {
                folderPath: undefined,
            },
        );
        fails("${workspaceFolder:other}", "Variable workspaceFolder can not be resolved. No such folder 'other'.");
        fails("${cwd:x}", "Variable cwd can not be resolved. No such folder 'x'.", { folderPath: undefined });
        fails("${workspaceFolder:proj}", "Variable workspaceFolder can not be resolved. No such folder 'proj'.", {
            folderPath: undefined,
        });
    });

    it("окружение и настройки без имени, настройка не найдена или структурная", () => {
        fails("${env}", "Variable ${env} can not be resolved because no environment variable name is given.");
        fails("${env:}", "Variable ${env:} can not be resolved because no environment variable name is given.");
        fails("${config}", "Variable ${config} can not be resolved because no settings name is given.");
        fails("${config:}", "Variable ${config:} can not be resolved because no settings name is given.");
        fails("${config:a.none}", "Variable ${config:a.none} can not be resolved because setting 'a.none' not found.");
        fails("${config:a.null}", "Variable ${config:a.null} can not be resolved because setting 'a.null' not found.");
        fails("${config:a.obj}", "Variable ${config:a.obj} can not be resolved because 'a.obj' is a structured value.");
    });

    it("нет домашнего каталога, нет строки каретки", () => {
        fails("${userHome}", "Variable ${userHome} can not be resolved. UserHome path is not defined", {
            userHome: undefined,
        });
        fails(
            "${lineNumber}",
            "Variable ${lineNumber} can not be resolved. Make sure to have a line selected in the active editor.",
            { lineNumber: undefined },
        );
    });

    it("${input:…} и ${command:…} — не поддержаны: явный отказ, а не литерал", () => {
        fails("${input:pick}", "Variable ${input:pick} is not supported in tasks yet.");
        fails("${command:x.y}", "Variable ${command:x.y} is not supported in tasks yet.");
    });
});
