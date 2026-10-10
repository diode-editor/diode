import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import type { FileService } from "../../../../platform/files/common/fileService.ts";
import type { ITreeFileWatcher } from "../../../../platform/files/common/iTreeFileWatcher.ts";

import { FileTreeDataProvider, type FileTreeNode } from "./fileTreeDataProvider.ts";

interface IFakeWatch {
    readonly path: string;
    readonly fire: (paths: string[]) => void;
    disposed: boolean;
}

/** Наблюдатель дерева, которым тест управляет руками. */
function fakeTreeWatcher(): ITreeFileWatcher & { watches: IFakeWatch[]; live(): string[] } {
    const watches: IFakeWatch[] = [];
    return {
        watches,
        live: () => watches.filter((watch) => !watch.disposed).map((watch) => watch.path),
        watchTree(rootPath, _options, onChanges) {
            const watch: IFakeWatch = {
                path: rootPath,
                fire: (paths) => {
                    onChanges(paths.map((path) => ({ type: "changed", path })));
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

describe("FileTreeDataProvider — explorer.compactFolders", () => {
    let ws: ITempWorkspace;
    let files: FileService;
    let watcher: ReturnType<typeof fakeTreeWatcher>;
    let compact: boolean;
    let excludes: string[];
    let provider: FileTreeDataProvider;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-compact-",
            files: { "pkg/a/b/C.java": "", "pkg/a/b/D.java": "", "README.md": "" },
        });
        files = diskFileService();
        watcher = fakeTreeWatcher();
        compact = true;
        excludes = [];
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

    /** Узел `pkg` из листинга корня — тот объект, что держала бы строка дерева. */
    async function pkgNode(): Promise<FileTreeNode> {
        // По ключу, а не по имени: у компактного узла `name` — последняя папка.
        const node = (await provider.getChildren()).find((child) => provider.getKey(child) === ws.path("pkg"));
        if (!node) throw new Error("pkg не найден в корне");
        return node;
    }

    it("до раскрытия цепочка не известна — каталог показывается как есть", async () => {
        const pkg = await pkgNode();
        expect(pkg.path).toBe(ws.path("pkg"));
        expect(pkg.compactParents).toBeUndefined();
        expect(provider.getTreeItem(pkg).label).toBe("pkg");
    });

    it("раскрытие проходит цепочку: дети последней папки, узел переписан, ключ — голова", async () => {
        const pkg = await pkgNode();

        const children = await provider.getChildren(pkg);

        expect(children.map((child) => child.name)).toEqual(["C.java", "D.java"]);
        expect(pkg.path).toBe(ws.path("pkg/a/b"));
        expect(pkg.name).toBe("b");
        expect(pkg.compactParents).toEqual([ws.path("pkg"), ws.path("pkg/a")]);
        expect(provider.getKey(pkg)).toBe(ws.path("pkg"));
        expect(provider.getTreeItem(pkg)).toMatchObject({ label: "pkg/a/b", collapsible: true });
    });

    it("следующий листинг родителя сразу отдаёт компактный узел", async () => {
        await provider.getChildren(await pkgNode());

        const again = await pkgNode();
        expect(provider.getTreeItem(again).label).toBe("pkg/a/b");
        expect(provider.getKey(again)).toBe(ws.path("pkg"));
        expect(provider.findNode(ws.path("pkg/a"))).toBe(again);
        expect(provider.keyForPath(ws.path("pkg/a/b"))).toBe(ws.path("pkg"));
        expect(provider.keyForPath(ws.path("README.md"))).toBe(ws.path("README.md"));
    });

    it("выключенная настройка — без спуска", async () => {
        compact = false;
        const pkg = await pkgNode();

        expect((await provider.getChildren(pkg)).map((child) => child.name)).toEqual(["a"]);
        expect(pkg.compactParents).toBeUndefined();
        expect(provider.getTreeItem(pkg).label).toBe("pkg");
    });

    it("resetCompactFolders забывает цепочки", async () => {
        await provider.getChildren(await pkgNode());
        provider.resetCompactFolders();

        expect(provider.getTreeItem(await pkgNode()).label).toBe("pkg");
        expect(provider.keyForPath(ws.path("pkg/a/b"))).toBe(ws.path("pkg/a/b"));
    });

    it("спуск останавливается на файле, на двух детях и на симлинке", async () => {
        fs.mkdirSync(ws.path("link-holder"));
        fs.symlinkSync(ws.path("pkg"), ws.path("link-holder/to-pkg"));
        const holder = (await provider.getChildren()).find((child) => child.name === "link-holder");
        if (!holder) throw new Error("link-holder не найден");

        // Единственный ребёнок — симлинк на каталог: не спускаемся (ссылка на
        // предка зациклила бы спуск).
        expect((await provider.getChildren(holder)).map((child) => child.name)).toEqual(["to-pkg"]);
        expect(provider.getTreeItem(holder).label).toBe("link-holder");
    });

    it("единственный ребёнок-файл цепочку не продолжает", async () => {
        ws.writeFile("solo/only.ts", "");
        const solo = (await provider.getChildren()).find((child) => child.name === "solo");
        if (!solo) throw new Error("solo не найден");

        expect((await provider.getChildren(solo)).map((child) => child.name)).toEqual(["only.ts"]);
        expect(solo.compactParents).toBeUndefined();
    });

    it("files.exclude решает, единственный ли ребёнок", async () => {
        ws.writeFile("pkg/a/notes.log", "");
        const pkg = await pkgNode();
        expect((await provider.getChildren(pkg)).map((child) => child.name)).toEqual(["b", "notes.log"]);
        expect(provider.getTreeItem(pkg).label).toBe("pkg/a");

        excludes = ["**/*.log"];
        expect((await provider.getChildren(pkg)).map((child) => child.name)).toEqual(["C.java", "D.java"]);
        expect(provider.getTreeItem(pkg).label).toBe("pkg/a/b");
    });

    describe("слежка", () => {
        it("за раскрытым компактным узлом следим по каждой папке цепочки; свернули — снимаем все", async () => {
            const pkg = await pkgNode();
            await provider.getChildren(pkg);

            provider.watchNode(pkg);
            expect(watcher.live()).toEqual([ws.path("pkg"), ws.path("pkg/a"), ws.path("pkg/a/b")]);

            provider.unwatchNode(pkg);
            expect(watcher.live()).toEqual([]);
        });

        it("цепочка раскрытого узла поменялась — слежка переезжает", async () => {
            const pkg = await pkgNode();
            await provider.getChildren(pkg);
            provider.watchNode(pkg);

            // Вторая запись в `a` — цепочка короче: `b` больше не её папка.
            ws.writeFile("pkg/a/x.ts", "");
            await provider.getChildren(pkg);
            expect(watcher.live()).toEqual([ws.path("pkg"), ws.path("pkg/a")]);

            // Запись ушла — цепочка снова до `b`.
            fs.rmSync(ws.path("pkg/a/x.ts"));
            await provider.getChildren(pkg);
            expect(watcher.live()).toEqual([ws.path("pkg"), ws.path("pkg/a"), ws.path("pkg/a/b")]);

            provider.unwatchNode(pkg);
            expect(watcher.live()).toEqual([]);
        });

        it("свёрнутый узел перечитывание не подписывает", async () => {
            const pkg = await pkgNode();
            await provider.getChildren(pkg);
            expect(watcher.live()).toEqual([]);
        });

        it("изменение в последней папке — перечитывается сам компактный узел (объект строки)", async () => {
            vi.useFakeTimers();
            const pkg = await pkgNode();
            await provider.getChildren(pkg);
            const row = await pkgNode();
            provider.watchNode(row);
            const onChange = vi.fn();
            provider.onChange = onChange;

            const tail = watcher.watches.find((watch) => watch.path === ws.path("pkg/a/b"));
            tail?.fire([ws.path("pkg/a/b/E.java")]);
            vi.advanceTimersByTime(300);

            expect(onChange).toHaveBeenCalledExactlyOnceWith(row);
            expect(provider.keyForPath(ws.path("pkg/a/b"))).toBe(ws.path("pkg"));
        });

        it("изменение в промежуточной папке рвёт цепочку и перечитывает родителя головы", async () => {
            vi.useFakeTimers();
            fs.mkdirSync(ws.path("outer"));
            fs.renameSync(ws.path("pkg"), ws.path("outer/pkg"));
            fs.mkdirSync(ws.path("outer/other"));
            const outer = (await provider.getChildren()).find((child) => child.name === "outer");
            if (!outer) throw new Error("outer не найден");
            const pkg = (await provider.getChildren(outer)).find((child) => child.name === "pkg");
            if (!pkg) throw new Error("pkg не найден");
            await provider.getChildren(pkg);
            provider.watchNode(pkg);
            const onChange = vi.fn();
            provider.onChange = onChange;

            const middle = watcher.watches.find((watch) => watch.path === ws.path("outer/pkg/a"));
            middle?.fire([ws.path("outer/pkg/a/x.ts")]);
            vi.advanceTimersByTime(300);

            expect(onChange).toHaveBeenCalledExactlyOnceWith(outer);
            // Цепочка забыта: следующий листинг соберёт узел заново.
            expect(provider.keyForPath(ws.path("outer/pkg/a/b"))).toBe(ws.path("outer/pkg/a/b"));
        });

        it("голова в корне — разрыв перечитывает всё дерево", async () => {
            vi.useFakeTimers();
            const pkg = await pkgNode();
            await provider.getChildren(pkg);
            provider.watchNode(pkg);
            const onChange = vi.fn();
            provider.onChange = onChange;

            const middle = watcher.watches.find((watch) => watch.path === ws.path("pkg/a"));
            middle?.fire([ws.path("pkg/a/x.ts")]);
            vi.advanceTimersByTime(300);

            expect(onChange).toHaveBeenCalledExactlyOnceWith(undefined);
        });

        it("разрыв у головы: хвост ниже неё остаётся цепочкой и сразу показывается компактным", async () => {
            vi.useFakeTimers();
            const pkg = await pkgNode();
            await provider.getChildren(pkg);
            provider.watchNode(pkg);
            provider.onChange = vi.fn();

            ws.writeFile("pkg/x.ts", "");
            watcher.watches.find((watch) => watch.path === ws.path("pkg"))?.fire([ws.path("pkg/x.ts")]);
            vi.advanceTimersByTime(300);

            expect(provider.keyForPath(ws.path("pkg/a/b"))).toBe(ws.path("pkg/a"));
            const row = await pkgNode();
            const children = await provider.getChildren(row);
            expect(children.map((child) => provider.getTreeItem(child).label)).toEqual(["a/b", "x.ts"]);
            expect(provider.getTreeItem(row).label).toBe("pkg");
        });

        it("каталог вне цепочек — перечитывается его узел из листинга", async () => {
            vi.useFakeTimers();
            compact = false;
            const pkg = await pkgNode();
            provider.watchNode(pkg);
            const onChange = vi.fn();
            provider.onChange = onChange;

            watcher.watches[0].fire([ws.path("pkg/new.ts")]);
            vi.advanceTimersByTime(300);

            expect(onChange).toHaveBeenCalledExactlyOnceWith(pkg);
        });
    });
});
