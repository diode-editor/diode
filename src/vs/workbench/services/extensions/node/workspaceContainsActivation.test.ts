import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CancellationTokenSource } from "../../../../base/common/cancellation.ts";

import {
    createNodeWorkspaceScanner,
    DEFAULT_WORKSPACE_CONTAINS_EXCLUDES,
    type IWorkspaceDirectoryEntry,
    type IWorkspaceScanner,
    matchWorkspaceContains,
} from "./workspaceContainsActivation.ts";

/**
 * Сканер поверх карты «относительный posix-путь → это каталог». Корнем считается
 * `/root`; пути от {@link matchWorkspaceContains} приходят через `path.join`, то
 * есть в нативной форме — приводим обратно к posix, чтобы карта читалась глазами.
 */
function fakeScanner(root: string, tree: Readonly<Record<string, "dir" | "file">>): IWorkspaceScanner {
    const relative = (absolutePath: string): string => path.relative(root, absolutePath).split(path.sep).join("/");
    return {
        // `Object.hasOwn`, а не `tree[...] !== undefined`: индекс справочника с
        // произвольным ключом для TS всегда непустой (см. AGENTS.md).
        exists: (absolutePath) => Promise.resolve(Object.hasOwn(tree, relative(absolutePath))),
        readDirectory: (absolutePath): Promise<readonly IWorkspaceDirectoryEntry[]> => {
            const prefix = relative(absolutePath);
            const entries: IWorkspaceDirectoryEntry[] = [];
            for (const [entryPath, kind] of Object.entries(tree)) {
                const parent = entryPath.includes("/") ? entryPath.slice(0, entryPath.lastIndexOf("/")) : "";
                if (parent !== prefix) continue;
                entries.push({
                    name: entryPath.slice(parent === "" ? 0 : parent.length + 1),
                    isDirectory: kind === "dir",
                });
            }
            return Promise.resolve(entries);
        },
    };
}

const ROOT = path.join(path.sep, "root");

describe("matchWorkspaceContains — паттерны-пути (без glob-символов)", () => {
    it("файл в корне папки воркспейса", async () => {
        const scanner = fakeScanner(ROOT, { "pom.xml": "file" });
        await expect(matchWorkspaceContains(scanner, [ROOT], { paths: ["pom.xml"], globs: [] })).resolves.toEqual({
            pattern: "pom.xml",
            truncated: false,
        });
    });

    it("КАТАЛОГ тоже считается существующим (семантика exists, как в эталоне)", async () => {
        const scanner = fakeScanner(ROOT, { ".vscode": "dir" });
        await expect(matchWorkspaceContains(scanner, [ROOT], { paths: [".vscode"], globs: [] })).resolves.toEqual({
            pattern: ".vscode",
            truncated: false,
        });
    });

    it("вложенный путь проверяется целиком, без обхода", async () => {
        const scanner = fakeScanner(ROOT, { "a/b/c.json": "file" });
        const readDirectory = vi.spyOn(scanner, "readDirectory");
        await expect(matchWorkspaceContains(scanner, [ROOT], { paths: ["a/b/c.json"], globs: [] })).resolves.toEqual({
            pattern: "a/b/c.json",
            truncated: false,
        });
        expect(readDirectory).not.toHaveBeenCalled();
    });

    it("отсутствующий путь — не совпало, обход не оборван", async () => {
        const scanner = fakeScanner(ROOT, { "build.gradle": "file" });
        await expect(matchWorkspaceContains(scanner, [ROOT], { paths: ["pom.xml"], globs: [] })).resolves.toEqual({
            pattern: null,
            truncated: false,
        });
    });

    it("несколько папок воркспейса: хватает попадания в любой", async () => {
        const second = path.join(path.sep, "other");
        const first = fakeScanner(ROOT, {});
        const scanner: IWorkspaceScanner = {
            exists: (absolutePath) => Promise.resolve(absolutePath === path.join(second, "pom.xml")),
            readDirectory: first.readDirectory,
        };
        await expect(
            matchWorkspaceContains(scanner, [ROOT, second], { paths: ["pom.xml"], globs: [] }),
        ).resolves.toEqual({ pattern: "pom.xml", truncated: false });
    });

    it("возвращается ПЕРВЫЙ подошедший паттерн — он и есть причина активации", async () => {
        const scanner = fakeScanner(ROOT, { "pom.xml": "file", "build.gradle": "file" });
        await expect(
            matchWorkspaceContains(scanner, [ROOT], { paths: ["build.gradle", "pom.xml"], globs: [] }),
        ).resolves.toEqual({ pattern: "build.gradle", truncated: false });
    });

    it("паттерны-пути проверяются РАНЬШЕ обхода: дешёвое попадание не читает каталоги", async () => {
        const scanner = fakeScanner(ROOT, { "pom.xml": "file", sub: "dir", "sub/pom.xml": "file" });
        const readDirectory = vi.spyOn(scanner, "readDirectory");
        await expect(
            matchWorkspaceContains(scanner, [ROOT], { paths: ["pom.xml"], globs: ["*/pom.xml"] }),
        ).resolves.toEqual({ pattern: "pom.xml", truncated: false });
        expect(readDirectory).not.toHaveBeenCalled();
    });
});

describe("matchWorkspaceContains — паттерны-globs (обход дерева)", () => {
    it("`*/pom.xml` находит файл на первом уровне", async () => {
        const scanner = fakeScanner(ROOT, { app: "dir", "app/pom.xml": "file" });
        await expect(matchWorkspaceContains(scanner, [ROOT], { paths: [], globs: ["*/pom.xml"] })).resolves.toEqual({
            pattern: "*/pom.xml",
            truncated: false,
        });
    });

    it("`*/pom.xml` НЕ находит файл в корне: `*` — это ровно один сегмент", async () => {
        const scanner = fakeScanner(ROOT, { "pom.xml": "file" });
        await expect(matchWorkspaceContains(scanner, [ROOT], { paths: [], globs: ["*/pom.xml"] })).resolves.toEqual({
            pattern: null,
            truncated: false,
        });
    });

    it("`*.py` матчит только корень — глубже обход не спускается", async () => {
        const scanner = fakeScanner(ROOT, { src: "dir", "src/main.py": "file" });
        const readDirectory = vi.spyOn(scanner, "readDirectory");
        await expect(matchWorkspaceContains(scanner, [ROOT], { paths: [], globs: ["*.py"] })).resolves.toEqual({
            pattern: null,
            truncated: false,
        });
        // Ровно один вызов — корень; `src/` не читался, глубина исчерпана.
        expect(readDirectory).toHaveBeenCalledTimes(1);
    });

    it("`**/pyproject.toml` достаёт файл с любой глубины", async () => {
        const scanner = fakeScanner(ROOT, {
            a: "dir",
            "a/b": "dir",
            "a/b/c": "dir",
            "a/b/c/pyproject.toml": "file",
        });
        await expect(
            matchWorkspaceContains(scanner, [ROOT], { paths: [], globs: ["**/pyproject.toml"] }),
        ).resolves.toEqual({ pattern: "**/pyproject.toml", truncated: false });
    });

    it("`**/x` матчит и в корне (ведущий `**/` — ноль сегментов)", async () => {
        const scanner = fakeScanner(ROOT, { "ruff.toml": "file" });
        await expect(matchWorkspaceContains(scanner, [ROOT], { paths: [], globs: ["**/ruff.toml"] })).resolves.toEqual({
            pattern: "**/ruff.toml",
            truncated: false,
        });
    });

    it("КАТАЛОГ под glob не считается совпадением: событие про файл", async () => {
        const scanner = fakeScanner(ROOT, { sub: "dir", "sub/pom.xml": "dir" });
        await expect(matchWorkspaceContains(scanner, [ROOT], { paths: [], globs: ["*/pom.xml"] })).resolves.toEqual({
            pattern: null,
            truncated: false,
        });
    });

    it("в node_modules/.git обход не заходит", async () => {
        const scanner = fakeScanner(ROOT, {
            node_modules: "dir",
            "node_modules/dep": "dir",
            "node_modules/dep/pyproject.toml": "file",
            ".git": "dir",
            ".git/pyproject.toml": "file",
        });
        await expect(
            matchWorkspaceContains(scanner, [ROOT], { paths: [], globs: ["**/pyproject.toml"] }),
        ).resolves.toEqual({ pattern: null, truncated: false });
        expect([...DEFAULT_WORKSPACE_CONTAINS_EXCLUDES]).toEqual([".git", "node_modules"]);
    });

    it("свой список исключений перебивает дефолтный", async () => {
        const scanner = fakeScanner(ROOT, {
            node_modules: "dir",
            "node_modules/pyproject.toml": "file",
        });
        await expect(
            matchWorkspaceContains(
                scanner,
                [ROOT],
                { paths: [], globs: ["**/pyproject.toml"] },
                { excludeDirectories: new Set() },
            ),
        ).resolves.toEqual({ pattern: "**/pyproject.toml", truncated: false });
    });

    it("несколько папок воркспейса: обход идёт по каждой", async () => {
        const second = path.join(path.sep, "other");
        const empty = fakeScanner(ROOT, {});
        const withHit = fakeScanner(second, { app: "dir", "app/pom.xml": "file" });
        const scanner: IWorkspaceScanner = {
            exists: () => Promise.resolve(false),
            readDirectory: (absolutePath) =>
                absolutePath.startsWith(second)
                    ? withHit.readDirectory(absolutePath)
                    : empty.readDirectory(absolutePath),
        };
        await expect(
            matchWorkspaceContains(scanner, [ROOT, second], { paths: [], globs: ["*/pom.xml"] }),
        ).resolves.toEqual({ pattern: "*/pom.xml", truncated: false });
    });

    it("обход в ШИРИНУ: мелкое совпадение находится, не спускаясь в глубокую ветку", async () => {
        const scanner = fakeScanner(ROOT, {
            deep: "dir",
            "deep/a": "dir",
            "deep/a/b": "dir",
            zzz: "dir",
            "zzz/pyproject.toml": "file",
        });
        const readDirectory = vi.spyOn(scanner, "readDirectory");
        await expect(
            matchWorkspaceContains(scanner, [ROOT], { paths: [], globs: ["**/pyproject.toml"] }),
        ).resolves.toEqual({ pattern: "**/pyproject.toml", truncated: false });
        // Корень + два каталога первого уровня; `deep/a` и `deep/a/b` не тронуты.
        expect(readDirectory.mock.calls.map((call) => call[0])).toEqual([
            ROOT,
            path.join(ROOT, "deep"),
            path.join(ROOT, "zzz"),
        ]);
    });

    it("глубина считается по самому щедрому паттерну набора", async () => {
        const scanner = fakeScanner(ROOT, { a: "dir", "a/b": "dir", "a/b/pom.xml": "file" });
        await expect(
            matchWorkspaceContains(scanner, [ROOT], { paths: [], globs: ["*.py", "*/*/pom.xml"] }),
        ).resolves.toEqual({ pattern: "*/*/pom.xml", truncated: false });
    });
});

describe("matchWorkspaceContains — бюджет и отмена", () => {
    it("бюджет — ГРАНИЦА: каталог номер maxDirectories+1 уже не читается", async () => {
        // Совпадение лежит ровно в том каталоге, до которого бюджет не дотягивает
        // на один шаг: корень и `a` съедают оба слота, `b` остаётся непрочитанным.
        const scanner = fakeScanner(ROOT, { a: "dir", b: "dir", "b/pyproject.toml": "file" });
        await expect(
            matchWorkspaceContains(scanner, [ROOT], { paths: [], globs: ["**/pyproject.toml"] }, { maxDirectories: 2 }),
        ).resolves.toEqual({ pattern: null, truncated: true });
    });

    it("бюджет каталогов обрывает обход и ЧЕСТНО сообщает об усечении", async () => {
        const scanner = fakeScanner(ROOT, {
            a: "dir",
            b: "dir",
            c: "dir",
            "c/pyproject.toml": "file",
        });
        await expect(
            matchWorkspaceContains(scanner, [ROOT], { paths: [], globs: ["**/pyproject.toml"] }, { maxDirectories: 2 }),
        ).resolves.toEqual({ pattern: null, truncated: true });
    });

    it("усечение в одной папке видно, даже когда вторая дочитана до конца", async () => {
        const second = path.join(path.sep, "other");
        const wide = fakeScanner(ROOT, { a: "dir", b: "dir", c: "dir" });
        const empty = fakeScanner(second, {});
        const scanner: IWorkspaceScanner = {
            exists: () => Promise.resolve(false),
            readDirectory: (absolutePath) =>
                absolutePath.startsWith(second) ? empty.readDirectory(absolutePath) : wide.readDirectory(absolutePath),
        };
        await expect(
            matchWorkspaceContains(
                scanner,
                [ROOT, second],
                { paths: [], globs: ["**/pyproject.toml"] },
                { maxDirectories: 2 },
            ),
        ).resolves.toEqual({ pattern: null, truncated: true });
    });

    it("отменённый токен обрывает обход глобов", async () => {
        const source = new CancellationTokenSource();
        source.cancel();
        const scanner = fakeScanner(ROOT, { "pom.xml": "file" });
        await expect(
            matchWorkspaceContains(scanner, [ROOT], { paths: [], globs: ["*.xml"] }, { token: source.token }),
        ).resolves.toEqual({ pattern: null, truncated: true });
    });

    it("отменённый токен обрывает и дешёвые проверки путей", async () => {
        const source = new CancellationTokenSource();
        source.cancel();
        const scanner = fakeScanner(ROOT, { "pom.xml": "file" });
        const exists = vi.spyOn(scanner, "exists");
        await expect(
            matchWorkspaceContains(scanner, [ROOT], { paths: ["pom.xml"], globs: [] }, { token: source.token }),
        ).resolves.toEqual({ pattern: null, truncated: true });
        expect(exists).not.toHaveBeenCalled();
    });

    it("отмена ПОСРЕДИ обхода останавливает его", async () => {
        const source = new CancellationTokenSource();
        const scanner = fakeScanner(ROOT, { a: "dir", "a/deep": "dir", "a/deep/pom.xml": "file" });
        const readDirectory = vi.spyOn(scanner, "readDirectory").mockImplementation((absolutePath) => {
            // Корень прочитан — запрос больше никому не нужен.
            if (absolutePath === ROOT) source.cancel();
            return Promise.resolve([{ name: "a", isDirectory: true }]);
        });
        await expect(
            matchWorkspaceContains(scanner, [ROOT], { paths: [], globs: ["**/pom.xml"] }, { token: source.token }),
        ).resolves.toEqual({ pattern: null, truncated: true });
        expect(readDirectory).toHaveBeenCalledTimes(1);
    });

    it("пустой набор паттернов — ни одного обращения к ФС", async () => {
        const scanner = fakeScanner(ROOT, { "pom.xml": "file" });
        const exists = vi.spyOn(scanner, "exists");
        const readDirectory = vi.spyOn(scanner, "readDirectory");
        await expect(matchWorkspaceContains(scanner, [ROOT], { paths: [], globs: [] })).resolves.toEqual({
            pattern: null,
            truncated: false,
        });
        expect(exists).not.toHaveBeenCalled();
        expect(readDirectory).not.toHaveBeenCalled();
    });

    it("без открытых папок считать нечего", async () => {
        const scanner = fakeScanner(ROOT, { "pom.xml": "file" });
        await expect(matchWorkspaceContains(scanner, [], { paths: ["pom.xml"], globs: ["*.xml"] })).resolves.toEqual({
            pattern: null,
            truncated: false,
        });
    });
});

describe("createNodeWorkspaceScanner — настоящая ФС", () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "diode-wsc-"));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it("exists: файл, каталог, отсутствующий путь", async () => {
        const scanner = createNodeWorkspaceScanner();
        fs.writeFileSync(path.join(root, "pom.xml"), "<project/>");
        fs.mkdirSync(path.join(root, "src"));
        await expect(scanner.exists(path.join(root, "pom.xml"))).resolves.toBe(true);
        await expect(scanner.exists(path.join(root, "src"))).resolves.toBe(true);
        await expect(scanner.exists(path.join(root, "nope"))).resolves.toBe(false);
    });

    it("readDirectory различает файлы и каталоги", async () => {
        const scanner = createNodeWorkspaceScanner();
        fs.writeFileSync(path.join(root, "a.txt"), "a");
        fs.mkdirSync(path.join(root, "sub"));
        const entries = [...(await scanner.readDirectory(root))].sort((x, y) => x.name.localeCompare(y.name));
        expect(entries).toEqual([
            { name: "a.txt", isDirectory: false },
            { name: "sub", isDirectory: true },
        ]);
    });

    it("readDirectory несуществующего каталога — пустой список, а не исключение", async () => {
        const scanner = createNodeWorkspaceScanner();
        await expect(scanner.readDirectory(path.join(root, "nope"))).resolves.toEqual([]);
    });

    it("сквозняк: maven-раскладка поднимает `*/pom.xml` на настоящих файлах", async () => {
        fs.mkdirSync(path.join(root, "module-a"));
        fs.writeFileSync(path.join(root, "module-a", "pom.xml"), "<project/>");
        await expect(
            matchWorkspaceContains(createNodeWorkspaceScanner(), [root], {
                paths: ["pom.xml"],
                globs: ["*/pom.xml"],
            }),
        ).resolves.toEqual({ pattern: "*/pom.xml", truncated: false });
    });

    it("симлинк на каталог не раскрывается — обход не зацикливается", async () => {
        fs.mkdirSync(path.join(root, "real"));
        fs.writeFileSync(path.join(root, "real", "pom.xml"), "<project/>");
        fs.symlinkSync(root, path.join(root, "real", "loop"), "dir");
        await expect(
            matchWorkspaceContains(createNodeWorkspaceScanner(), [root], {
                paths: [],
                globs: ["**/nothing.xml"],
            }),
        ).resolves.toEqual({ pattern: null, truncated: false });
    });
});
