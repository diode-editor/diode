import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import type { FileService } from "../../../../platform/files/common/fileService.ts";
import type {
    ITreeFileChange,
    ITreeFileWatcher,
    ITreeFileWatchOptions,
} from "../../../../platform/files/common/iTreeFileWatcher.ts";

import { FileTreeDataProvider } from "./fileTreeDataProvider.ts";

interface IFakeWatch {
    readonly path: string;
    readonly options: ITreeFileWatchOptions;
    readonly fire: (paths: string[]) => void;
    disposed: boolean;
}

/** Наблюдатель дерева, которым тест управляет руками. */
function fakeTreeWatcher(): ITreeFileWatcher & { watches: IFakeWatch[] } {
    const watches: IFakeWatch[] = [];
    return {
        watches,
        watchTree(rootPath, options, onChanges) {
            const watch: IFakeWatch = {
                path: rootPath,
                options,
                fire: (paths) => {
                    onChanges(paths.map((path): ITreeFileChange => ({ type: "changed", path })));
                },
                disposed: false,
            };
            watches.push(watch);
            return {
                dispose: () => {
                    watch.disposed = true;
                },
            };
        },
    };
}

describe("FileTreeDataProvider", () => {
    let ws: ITempWorkspace;
    let provider: FileTreeDataProvider;
    let files: FileService;
    let watcher: ReturnType<typeof fakeTreeWatcher>;
    /** Шаблоны `files.exclude`: меняются по ходу теста — настройка живая. */
    let excludes: string[];
    /** `explorer.compactFolders`: здесь выключена — сжатие проверяет fileTreeDataProvider.compactFolders.test.ts. */
    let compact: boolean;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-test-" });
        excludes = [];
        compact = false;
        files = diskFileService();
        watcher = fakeTreeWatcher();
        provider = new FileTreeDataProvider(
            ws.dir,
            () => excludes,
            files,
            watcher,
            () => compact,
        );
    });

    afterEach(() => {
        vi.useRealTimers();
        provider.dispose();
        files.dispose();
        ws.dispose();
    });

    describe("getChildren", () => {
        it("returns files and directories from root", async () => {
            ws.writeFile("file.ts", "");
            fs.mkdirSync(ws.path("src"));

            const children = await provider.getChildren();
            expect(children).toHaveLength(2);
        });

        it("sorts directories before files", async () => {
            ws.writeFile("b.ts", "");
            fs.mkdirSync(ws.path("aDir"));
            ws.writeFile("a.ts", "");

            const children = await provider.getChildren();
            expect(children[0].name).toBe("aDir");
            expect(children[0].isDirectory).toBe(true);
            expect(children[1].name).toBe("a.ts");
            expect(children[2].name).toBe("b.ts");
        });

        it("sorts files alphabetically", async () => {
            ws.writeFile("z.ts", "");
            ws.writeFile("a.ts", "");
            ws.writeFile("m.ts", "");

            const children = await provider.getChildren();
            expect(children.map((c) => c.name)).toEqual(["a.ts", "m.ts", "z.ts"]);
        });

        it("скрывает входы по шаблонам files.exclude", async () => {
            fs.mkdirSync(ws.path("__pycache__"));
            ws.writeFile(".DS_Store", "");
            ws.writeFile("index.ts", "");
            excludes = ["**/__pycache__", "**/.DS_Store"];

            const children = await provider.getChildren();
            expect(children.map((c) => c.name)).toEqual(["index.ts"]);
        });

        it("без шаблонов не скрывает ничего — захардкоженного списка больше нет", async () => {
            fs.mkdirSync(ws.path("node_modules"));
            ws.writeFile("index.ts", "");

            expect((await provider.getChildren()).map((c) => c.name)).toEqual(["node_modules", "index.ts"]);
        });

        it("шаблон матчится против пути ОТНОСИТЕЛЬНО корня дерева", async () => {
            // `**/x` режет вход на любой глубине, `x` — только в корне: иначе
            // шаблон либо не доставал бы вложенные каталоги, либо резал бы
            // одноимённые где попало.
            fs.mkdirSync(ws.path("pkg"), { recursive: true });
            fs.mkdirSync(ws.path("pkg/out"));
            fs.mkdirSync(ws.path("out"));
            const pkg = { name: "pkg", path: ws.path("pkg"), isDirectory: true };

            excludes = ["out"];
            expect((await provider.getChildren()).map((c) => c.name)).toEqual(["pkg"]);
            expect((await provider.getChildren(pkg)).map((c) => c.name)).toEqual(["out"]);

            excludes = ["**/out"];
            expect(await provider.getChildren(pkg)).toEqual([]);
        });

        it("набор читается на каждое обращение — настройка применяется без рестарта", async () => {
            fs.mkdirSync(ws.path("__pycache__"));
            excludes = ["**/__pycache__"];
            expect(await provider.getChildren()).toEqual([]);

            excludes = [];
            expect((await provider.getChildren()).map((c) => c.name)).toEqual(["__pycache__"]);
        });

        it("returns children of a subdirectory", async () => {
            const subDir = ws.path("src");
            ws.writeFile("src/main.ts", "");
            ws.writeFile("src/util.ts", "");

            const dirNode = { name: "src", path: subDir, isDirectory: true };
            const children = await provider.getChildren(dirNode);
            expect(children).toHaveLength(2);
            expect(children.map((c) => c.name)).toEqual(["main.ts", "util.ts"]);
        });

        it("returns empty array for empty directory", async () => {
            const subDir = ws.path("empty");
            fs.mkdirSync(subDir);

            const dirNode = { name: "empty", path: subDir, isDirectory: true };
            expect(await provider.getChildren(dirNode)).toEqual([]);
        });

        it("returns empty array for non-existent directory", async () => {
            const dirNode = { name: "nope", path: ws.path("nope"), isDirectory: true };
            expect(await provider.getChildren(dirNode)).toEqual([]);
        });

        it("orders files after directories for a dir/file/dir name sequence (sort branch 119)", async () => {
            // readdir yields these alphabetically as [a-dir, b-file, c-dir] — a
            // dir/file/dir sequence that drives the comparator down BOTH the
            // `-1` (dir before file) and `1` (file after dir) paths.
            fs.mkdirSync(ws.path("a-dir"));
            ws.writeFile("b-file.ts", "");
            fs.mkdirSync(ws.path("c-dir"));

            const children = await provider.getChildren();
            // Directories first (sorted), then the file.
            expect(children.map((c) => c.name)).toEqual(["a-dir", "c-dir", "b-file.ts"]);
            expect(children.map((c) => c.isDirectory)).toEqual([true, true, false]);
        });
    });

    describe("symlinks", () => {
        it("marks a symlink to a file as a symbolic link, not a directory", async () => {
            ws.writeFile("target.ts", "");
            fs.symlinkSync(ws.path("target.ts"), ws.path("link.ts"));

            const children = await provider.getChildren();
            const link = children.find((c) => c.name === "link.ts");
            expect(link).toBeDefined();
            expect(link?.isSymbolicLink).toBe(true);
            expect(link?.isDirectory).toBe(false);
        });

        it("resolves a symlink to a directory as a directory", async () => {
            fs.mkdirSync(ws.path("realDir"));
            fs.symlinkSync(ws.path("realDir"), ws.path("linkDir"));

            const children = await provider.getChildren();
            const link = children.find((c) => c.name === "linkDir");
            expect(link?.isSymbolicLink).toBe(true);
            expect(link?.isDirectory).toBe(true);
        });

        it("treats a broken symlink as a non-directory file", async () => {
            fs.symlinkSync(ws.path("does-not-exist"), ws.path("broken"));

            const children = await provider.getChildren();
            const link = children.find((c) => c.name === "broken");
            expect(link?.isSymbolicLink).toBe(true);
            expect(link?.isDirectory).toBe(false);
        });

        it("flags a symlinked file while keeping its normal type icon", async () => {
            const node = { name: "link.ts", path: "/link.ts", isDirectory: false, isSymbolicLink: true };
            const item = provider.getTreeItem(node);
            expect(item.symlink).toBe(true);
            // The type icon is preserved — same as a non-symlink .ts file (icon not hidden).
            const plain = provider.getTreeItem({ name: "link.ts", path: "/link.ts", isDirectory: false });
            expect(item.icon).toBe(plain.icon);
            expect(item.iconColor).toBe(plain.iconColor);
        });

        it("flags a symlinked directory and keeps it collapsible", async () => {
            const node = { name: "linkDir", path: "/linkDir", isDirectory: true, isSymbolicLink: true };
            const item = provider.getTreeItem(node);
            expect(item.collapsible).toBe(true);
            expect(item.symlink).toBe(true);
        });

        it("does not flag a regular file or directory as a symlink", async () => {
            const file = provider.getTreeItem({ name: "main.ts", path: "/main.ts", isDirectory: false });
            const dir = provider.getTreeItem({ name: "src", path: "/src", isDirectory: true });
            expect(file.symlink).toBeFalsy();
            expect(dir.symlink).toBeFalsy();
        });
    });

    describe("getKey", () => {
        it("returns the file path as key", async () => {
            const node = { name: "test.ts", path: "/some/path/test.ts", isDirectory: false };
            expect(provider.getKey(node)).toBe("/some/path/test.ts");
        });
    });

    describe("getTreeItem", () => {
        it("marks directories as collapsible", async () => {
            const node = { name: "src", path: "/src", isDirectory: true };
            const item = provider.getTreeItem(node);
            expect(item.collapsible).toBe(true);
            expect(item.label).toBe("src");
        });

        it("marks files as non-collapsible", async () => {
            const node = { name: "main.ts", path: "/main.ts", isDirectory: false };
            const item = provider.getTreeItem(node);
            expect(item.collapsible).toBe(false);
        });

        it("provides icon for known file types", async () => {
            const node = { name: "main.ts", path: "/main.ts", isDirectory: false };
            const item = provider.getTreeItem(node);
            expect(item.icon).toBeDefined();
            expect(item.iconColor).toBeDefined();
        });

        it("does not provide icon for directories", async () => {
            const node = { name: "src", path: "/src", isDirectory: true };
            const item = provider.getTreeItem(node);
            expect(item.icon).toBeUndefined();
            expect(item.iconColor).toBeUndefined();
        });
    });

    describe("git status decorations", () => {
        it("has no decoration by default", async () => {
            const item = provider.getTreeItem({ name: "main.ts", path: "/main.ts", isDirectory: false });
            expect(item.labelColor).toBeUndefined();
            expect(item.badge).toBeUndefined();
        });

        it("maps a status entry onto the tree item by absolute path", async () => {
            provider.setGitStatus(new Map([["/main.ts", { color: 0x73c991, badge: "M" }]]));

            const decorated = provider.getTreeItem({ name: "main.ts", path: "/main.ts", isDirectory: false });
            expect(decorated.labelColor).toBe(0x73c991);
            // Пробел справа — отступ буквы от края панели (см. getTreeItem).
            expect(decorated.badge).toBe("M ");

            // A file not present in the status map stays undecorated.
            const plain = provider.getTreeItem({ name: "other.ts", path: "/other.ts", isDirectory: false });
            expect(plain.labelColor).toBeUndefined();
            expect(plain.badge).toBeUndefined();
        });

        it("decorates directories as well as files", async () => {
            provider.setGitStatus(new Map([["/src", { color: 0xe2c08d, badge: "U" }]]));

            const dir = provider.getTreeItem({ name: "src", path: "/src", isDirectory: true });
            expect(dir.collapsible).toBe(true);
            expect(dir.labelColor).toBe(0xe2c08d);
            expect(dir.badge).toBe("U ");
        });

        it("replaces the whole status map on each call", async () => {
            provider.setGitStatus(new Map([["/a.ts", { color: 0x111111, badge: "A" }]]));
            provider.setGitStatus(new Map([["/b.ts", { color: 0x222222, badge: "M" }]]));

            expect(provider.getTreeItem({ name: "a.ts", path: "/a.ts", isDirectory: false }).badge).toBeUndefined();
            expect(provider.getTreeItem({ name: "b.ts", path: "/b.ts", isDirectory: false }).badge).toBe("M ");
        });

        it("supports a colour-only or badge-only entry", async () => {
            provider.setGitStatus(
                new Map([
                    ["/colour-only.ts", { color: 0x73c991 }],
                    ["/badge-only.ts", { badge: "M" }],
                ]),
            );

            const colourOnly = provider.getTreeItem({ name: "c.ts", path: "/colour-only.ts", isDirectory: false });
            expect(colourOnly.labelColor).toBe(0x73c991);
            expect(colourOnly.badge).toBeUndefined();

            const badgeOnly = provider.getTreeItem({ name: "b.ts", path: "/badge-only.ts", isDirectory: false });
            expect(badgeOnly.labelColor).toBeUndefined();
            expect(badgeOnly.badge).toBe("M ");
        });
    });

    describe("file watching", () => {
        it("следит за раскрытым каталогом без рекурсии и без собственных excludes", () => {
            provider.watchDirectory(ws.dir);
            provider.watchDirectory(ws.dir); // повторно — та же подписка
            expect(watcher.watches).toHaveLength(1);
            expect(watcher.watches[0].path).toBe(ws.dir);
            expect(watcher.watches[0].options).toEqual({ recursive: false, excludes: [] });
        });

        it("событие в каталоге — onChange с узлом каталога после дебаунса; пачка — одно уведомление", () => {
            vi.useFakeTimers();
            const callback = vi.fn();
            provider.onChange = callback;
            provider.watchDirectory(ws.dir);

            watcher.watches[0].fire([ws.path("one.ts")]);
            vi.advanceTimersByTime(200);
            watcher.watches[0].fire([ws.path("two.ts")]);
            vi.advanceTimersByTime(299);
            expect(callback).not.toHaveBeenCalled();

            vi.advanceTimersByTime(1);
            expect(callback).toHaveBeenCalledExactlyOnceWith({
                name: ws.dir.slice(ws.dir.lastIndexOf("/") + 1),
                path: ws.dir,
                isDirectory: true,
            });
        });

        it("правка только скрытых настройкой файлов дерево не трогает", () => {
            vi.useFakeTimers();
            const callback = vi.fn();
            provider.onChange = callback;
            excludes = ["**/*.pyc"];
            provider.watchDirectory(ws.dir);

            watcher.watches[0].fire([ws.path("app.cpython-312.pyc")]);
            vi.advanceTimersByTime(1000);
            expect(callback).not.toHaveBeenCalled();

            // Контроль: в пачке есть свой файл — дерево перечитывается.
            watcher.watches[0].fire([ws.path("app.cpython-312.pyc"), ws.path("app.py")]);
            vi.advanceTimersByTime(300);
            expect(callback).toHaveBeenCalledOnce();
        });

        it("unwatch снимает подписку и гасит ждущее уведомление; чужой каталог — no-op", () => {
            vi.useFakeTimers();
            const callback = vi.fn();
            provider.onChange = callback;
            provider.watchDirectory(ws.dir);
            watcher.watches[0].fire([ws.path("a.ts")]);

            provider.unwatchDirectory(ws.path("never-watched"));
            expect(watcher.watches[0].disposed).toBe(false);
            provider.unwatchDirectory(ws.dir);
            expect(watcher.watches[0].disposed).toBe(true);
            vi.advanceTimersByTime(1000);
            expect(callback).not.toHaveBeenCalled();

            // Повторное раскрытие подписывается заново.
            provider.watchDirectory(ws.dir);
            expect(watcher.watches).toHaveLength(2);
        });

        it("dispose снимает подписки и гасит ждущие уведомления", () => {
            vi.useFakeTimers();
            const callback = vi.fn();
            provider.onChange = callback;
            provider.watchDirectory(ws.dir);
            watcher.watches[0].fire([ws.path("a.ts")]);

            provider.dispose();
            expect(watcher.watches[0].disposed).toBe(true);
            vi.advanceTimersByTime(1000);
            expect(callback).not.toHaveBeenCalled();
        });
    });
});
