import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadWorkspaceFile } from "../../workspace/common/workspaceFile.ts";

import { CliArgsError, parseCliArgs } from "./cliArgs.ts";
import { logicalWorkingDirectory, resolveStartupTargets } from "./startupTargets.ts";

/** Порт к FS: перечисленные пути — папки, всё остальное — файлы. */
function dirsAre(...dirs: string[]): (p: string) => boolean {
    const set = new Set(dirs.map((d) => path.resolve(d)));
    return (p) => set.has(p);
}

const noDirs = dirsAre();
const abs = (p: string): string => path.resolve(p);

describe("resolveStartupTargets", () => {
    it("gives an empty window when there are no positionals", () => {
        expect(resolveStartupTargets(parseCliArgs([]), noDirs)).toStrictEqual({
            folder: undefined,
            workspaceFile: undefined,
            files: [],
            diff: undefined,
        });
    });

    it("opens the first positional as the workspace folder", () => {
        const targets = resolveStartupTargets(parseCliArgs(["src", "a.ts"]), dirsAre("src"));
        expect(targets.folder).toBe(abs("src"));
        expect(targets.files).toEqual([{ path: abs("a.ts") }]);
    });

    it("leaves the window folderless when the first positional is a file", () => {
        // `diode a.ts src` — как в VS Code: папкой становится только ПЕРВЫЙ
        // аргумент, остальные директории просто не открываются.
        const targets = resolveStartupTargets(parseCliArgs(["a.ts", "src"]), dirsAre("src"));
        expect(targets.folder).toBeUndefined();
        expect(targets.files).toEqual([{ path: abs("a.ts") }]);
    });

    it("resolves relative paths to absolute", () => {
        const targets = resolveStartupTargets(parseCliArgs(["./a.ts"]), noDirs);
        expect(targets.files).toEqual([{ path: path.resolve("./a.ts") }]);
    });

    it("keeps a colon in the path when --goto was not given", () => {
        const targets = resolveStartupTargets(parseCliArgs(["weird:10"]), noDirs);
        expect(targets.files).toEqual([{ path: abs("weird:10") }]);
    });
});

describe("resolveStartupTargets — файл воркспейса", () => {
    // `code web.code-workspace` открывает воркспейс, а не файл во вкладке.
    it("первый позиционный *.code-workspace — файл воркспейса, а не вкладка", () => {
        const targets = resolveStartupTargets(parseCliArgs(["web.code-workspace", "a.ts"]), noDirs);
        expect(targets.workspaceFile).toBe(abs("web.code-workspace"));
        expect(targets.folder).toBeUndefined();
        expect(targets.files).toEqual([{ path: abs("a.ts") }]);
    });

    it("не первым — обычный файл", () => {
        const targets = resolveStartupTargets(parseCliArgs(["a.ts", "web.code-workspace"]), noDirs);
        expect(targets.workspaceFile).toBeUndefined();
        expect(targets.files).toEqual([{ path: abs("a.ts") }, { path: abs("web.code-workspace") }]);
    });

    // Каталог с таким именем — всё-таки папка: решает диск, а не расширение.
    it("каталог с расширением .code-workspace — папка", () => {
        const targets = resolveStartupTargets(parseCliArgs(["odd.code-workspace"]), dirsAre("odd.code-workspace"));
        expect(targets.folder).toBe(abs("odd.code-workspace"));
        expect(targets.workspaceFile).toBeUndefined();
    });

    // Через симлинк каталога: файл воркспейса — от логического cwd, остальное — от физического.
    it("путь файла воркспейса — от логического cwd", () => {
        const targets = resolveStartupTargets(parseCliArgs(["web.code-workspace", "a.ts"]), noDirs, "/home/me/link");
        expect(targets.workspaceFile).toBe("/home/me/link/web.code-workspace");
        expect(targets.files).toEqual([{ path: abs("a.ts") }]);
    });

    it("с --goto путь файла воркспейса — тоже от логического cwd", () => {
        const targets = resolveStartupTargets(parseCliArgs(["-g", "web.code-workspace"]), noDirs, "/home/me/link");
        expect(targets.workspaceFile).toBe("/home/me/link/web.code-workspace");
        expect(targets.files).toEqual([]);
    });

    it("при --diff файла воркспейса нет", () => {
        const targets = resolveStartupTargets(parseCliArgs(["-d", "a.code-workspace", "b.code-workspace"]), noDirs);
        expect(targets.workspaceFile).toBeUndefined();
        expect(targets.diff).toEqual({ original: abs("a.code-workspace"), modified: abs("b.code-workspace") });
    });
});

describe("resolveStartupTargets — --goto", () => {
    it("splits file:line", () => {
        const targets = resolveStartupTargets(parseCliArgs(["-g", "a.ts:42"]), noDirs);
        // Строго: без номера колонки ключа `column` быть НЕ должно — условный
        // спред здесь не украшение, а контракт (`toEqual` не видит лишнего
        // `column: undefined`).
        expect(targets.files).toStrictEqual([{ path: abs("a.ts"), line: 42 }]);
    });

    it("splits file:line:column", () => {
        const targets = resolveStartupTargets(parseCliArgs(["-g", "a.ts:42:7"]), noDirs);
        expect(targets.files).toStrictEqual([{ path: abs("a.ts"), line: 42, column: 7 }]);
    });

    it("accepts a plain path without a suffix", () => {
        const targets = resolveStartupTargets(parseCliArgs(["-g", "a.ts"]), noDirs);
        expect(targets.files).toStrictEqual([{ path: abs("a.ts") }]);
    });

    it("still honours a leading directory", () => {
        const targets = resolveStartupTargets(parseCliArgs(["-g", "src", "a.ts:3"]), dirsAre("src"));
        expect(targets.folder).toBe(abs("src"));
        expect(targets.files).toStrictEqual([{ path: abs("a.ts"), line: 3 }]);
    });

    it("throws when the suffix eats the whole argument", () => {
        expect(() => resolveStartupTargets(parseCliArgs(["-g", ":10"]), noDirs)).toThrow(CliArgsError);
        expect(() => resolveStartupTargets(parseCliArgs(["-g", ":10"]), noDirs)).toThrow(
            /file\[:line\[:column\]\], got: :10/,
        );
    });
});

describe("resolveStartupTargets — --diff", () => {
    it("returns both sides and opens no folder", () => {
        const targets = resolveStartupTargets(parseCliArgs(["-d", "a.ts", "b.ts"]), noDirs);
        expect(targets.diff).toEqual({ original: abs("a.ts"), modified: abs("b.ts") });
        expect(targets.folder).toBeUndefined();
        expect(targets.files).toEqual([]);
    });

    it("does not turn a directory side into a workspace folder", () => {
        const targets = resolveStartupTargets(parseCliArgs(["-d", "src", "b.ts"]), dirsAre("src"));
        expect(targets.folder).toBeUndefined();
        expect(targets.diff).toEqual({ original: abs("src"), modified: abs("b.ts") });
    });
});

describe("logicalWorkingDirectory", () => {
    const same = (): boolean => true;
    const differ = (): boolean => false;

    it("берёт $PWD, когда он ведёт в cwd", () => {
        expect(logicalWorkingDirectory("/home/me/link/", "/real/dir", same)).toBe("/home/me/link");
    });

    it("устаревший $PWD — физический cwd", () => {
        expect(logicalWorkingDirectory("/elsewhere", "/real/dir", differ)).toBe("/real/dir");
    });

    it("нет $PWD или он относительный — физический cwd", () => {
        expect(logicalWorkingDirectory(undefined, "/real/dir", same)).toBe("/real/dir");
        expect(logicalWorkingDirectory("link", "/real/dir", same)).toBe("/real/dir");
    });
});

describe("файл воркспейса через симлинки — на настоящем диске", () => {
    let root: string | undefined;
    afterEach(() => {
        if (root !== undefined) fs.rmSync(root, { recursive: true, force: true });
        root = undefined;
    });

    const reader = {
        readText: (filePath: string) => fs.promises.readFile(filePath, "utf-8"),
        isDirectory: (filePath: string) =>
            Promise.resolve(fs.statSync(filePath, { throwIfNoEntry: false })?.isDirectory() === true),
    };
    const sameDirectory = (a: string, b: string): boolean => {
        const sa = fs.statSync(a);
        const sb = fs.statSync(b);
        return sa.dev === sb.dev && sa.ino === sb.ino;
    };

    it("cwd через симлинк каталога: папки — от названного пути, симлинк не разворачивается", async () => {
        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "diode-ws-")));
        fs.mkdirSync(path.join(root, "real", "proj"), { recursive: true });
        fs.writeFileSync(path.join(root, "real", "w.code-workspace"), JSON.stringify({ folders: [{ path: "proj" }] }));
        fs.symlinkSync(path.join(root, "real"), path.join(root, "link"));
        const link = path.join(root, "link");

        // Так стартует бинарь, запущенный из `cd link`: Node видит физический cwd.
        const cwd = logicalWorkingDirectory(link, path.join(root, "real"), sameDirectory);
        const targets = resolveStartupTargets(parseCliArgs(["w.code-workspace"]), () => false, cwd);
        expect(targets.workspaceFile).toBe(path.join(link, "w.code-workspace"));
        const contents = await loadWorkspaceFile(targets.workspaceFile ?? "", reader);
        expect(contents.folder).toBe(path.join(link, "proj"));
    });

    it("сам файл — симлинк: папки — от каталога ссылки, а не цели", async () => {
        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "diode-ws-")));
        fs.mkdirSync(path.join(root, "configs"));
        fs.mkdirSync(path.join(root, "repo", "proj"), { recursive: true });
        fs.writeFileSync(
            path.join(root, "configs", "w.code-workspace"),
            JSON.stringify({ folders: [{ path: "proj" }] }),
        );
        const file = path.join(root, "repo", "w.code-workspace");
        fs.symlinkSync(path.join(root, "configs", "w.code-workspace"), file);

        const contents = await loadWorkspaceFile(file, reader);
        expect(contents.folder).toBe(path.join(root, "repo", "proj"));
    });
});
