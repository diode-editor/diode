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

    /** The `pkg` node from the root listing — the object a tree row would hold. */
    async function pkgNode(): Promise<FileTreeNode> {
        // By key, not by name: a compact node's `name` is the last folder.
        const node = (await provider.getChildren()).find((child) => provider.getKey(child) === ws.path("pkg"));
        if (!node) throw new Error("pkg not found in root");
        return node;
    }

    it("before expansion the chain is unknown — the directory is shown as is", async () => {
        const pkg = await pkgNode();
        expect(pkg.path).toBe(ws.path("pkg"));
        expect(pkg.compactParents).toBeUndefined();
        expect(provider.getTreeItem(pkg).label).toBe("pkg");
    });

    it("expansion walks the chain: children of the last folder, node rewritten, key is the head", async () => {
        const pkg = await pkgNode();

        const children = await provider.getChildren(pkg);

        expect(children.map((child) => child.name)).toEqual(["C.java", "D.java"]);
        expect(pkg.path).toBe(ws.path("pkg/a/b"));
        expect(pkg.name).toBe("b");
        expect(pkg.compactParents).toEqual([ws.path("pkg"), ws.path("pkg/a")]);
        expect(provider.getKey(pkg)).toBe(ws.path("pkg"));
        expect(provider.getTreeItem(pkg)).toMatchObject({ label: "pkg/a/b", collapsible: true });
    });

    it("the parent's next listing returns the compact node right away", async () => {
        await provider.getChildren(await pkgNode());

        const again = await pkgNode();
        expect(provider.getTreeItem(again).label).toBe("pkg/a/b");
        expect(provider.getKey(again)).toBe(ws.path("pkg"));
        expect(provider.findNode(ws.path("pkg/a"))).toBe(again);
        expect(provider.keyForPath(ws.path("pkg/a/b"))).toBe(ws.path("pkg"));
        expect(provider.keyForPath(ws.path("README.md"))).toBe(ws.path("README.md"));
    });

    it("chain shrank to one folder — the same node is plain again, and so is the parent's listing", async () => {
        const pkg = await pkgNode();
        await provider.getChildren(pkg);
        expect(provider.getTreeItem(pkg).label).toBe("pkg/a/b");

        ws.writeFile("pkg/x.ts", "");
        expect((await provider.getChildren(pkg)).map((child) => child.name)).toEqual(["a", "x.ts"]);
        expect(pkg.compactParents).toBeUndefined();
        expect(pkg.path).toBe(ws.path("pkg"));
        expect(provider.getTreeItem(pkg).label).toBe("pkg");

        const again = await pkgNode();
        expect(provider.getTreeItem(again).label).toBe("pkg");
        expect(provider.keyForPath(ws.path("pkg/a/b"))).toBe(ws.path("pkg/a/b"));
    });

    it("findNode knows only directories", async () => {
        await provider.getChildren();
        expect(provider.findNode(ws.path("pkg"))).toBeDefined();
        expect(provider.findNode(ws.path("README.md"))).toBeUndefined();
    });

    it("setting disabled — no descent", async () => {
        compact = false;
        const pkg = await pkgNode();

        expect((await provider.getChildren(pkg)).map((child) => child.name)).toEqual(["a"]);
        expect(pkg.compactParents).toBeUndefined();
        expect(provider.getTreeItem(pkg).label).toBe("pkg");
    });

    it("resetCompactFolders forgets the chains", async () => {
        await provider.getChildren(await pkgNode());
        provider.resetCompactFolders();

        expect(provider.getTreeItem(await pkgNode()).label).toBe("pkg");
        expect(provider.keyForPath(ws.path("pkg/a/b"))).toBe(ws.path("pkg/a/b"));
    });

    it("descent stops at a file, at two children and at a symlink", async () => {
        fs.mkdirSync(ws.path("link-holder"));
        fs.symlinkSync(ws.path("pkg"), ws.path("link-holder/to-pkg"));
        const holder = (await provider.getChildren()).find((child) => child.name === "link-holder");
        if (!holder) throw new Error("link-holder not found");

        // The only child is a symlink to a directory: don't descend (a link to
        // an ancestor would loop the descent).
        expect((await provider.getChildren(holder)).map((child) => child.name)).toEqual(["to-pkg"]);
        expect(provider.getTreeItem(holder).label).toBe("link-holder");
    });

    it("a single file child does not extend the chain", async () => {
        ws.writeFile("solo/only.ts", "");
        const solo = (await provider.getChildren()).find((child) => child.name === "solo");
        if (!solo) throw new Error("solo not found");

        expect((await provider.getChildren(solo)).map((child) => child.name)).toEqual(["only.ts"]);
        expect(solo.compactParents).toBeUndefined();
    });

    it("files.exclude decides whether the child is the only one", async () => {
        ws.writeFile("pkg/a/notes.log", "");
        const pkg = await pkgNode();
        expect((await provider.getChildren(pkg)).map((child) => child.name)).toEqual(["b", "notes.log"]);
        expect(provider.getTreeItem(pkg).label).toBe("pkg/a");

        excludes = ["**/*.log"];
        expect((await provider.getChildren(pkg)).map((child) => child.name)).toEqual(["C.java", "D.java"]);
        expect(provider.getTreeItem(pkg).label).toBe("pkg/a/b");
    });

    describe("watching", () => {
        it("an expanded compact node is watched on every folder of the chain; collapsed — all are removed", async () => {
            const pkg = await pkgNode();
            await provider.getChildren(pkg);

            provider.watchNode(pkg);
            expect(watcher.live()).toEqual([ws.path("pkg"), ws.path("pkg/a"), ws.path("pkg/a/b")]);

            provider.unwatchNode(pkg);
            expect(watcher.live()).toEqual([]);
        });

        it("the expanded node's chain changed — watching moves", async () => {
            const pkg = await pkgNode();
            await provider.getChildren(pkg);
            provider.watchNode(pkg);

            // A second entry in `a` shortens the chain: `b` is no longer part of it.
            ws.writeFile("pkg/a/x.ts", "");
            await provider.getChildren(pkg);
            expect(watcher.live()).toEqual([ws.path("pkg"), ws.path("pkg/a")]);

            // The entry is gone — the chain reaches `b` again.
            fs.rmSync(ws.path("pkg/a/x.ts"));
            await provider.getChildren(pkg);
            expect(watcher.live()).toEqual([ws.path("pkg"), ws.path("pkg/a"), ws.path("pkg/a/b")]);

            provider.unwatchNode(pkg);
            expect(watcher.live()).toEqual([]);
            // Folders that stayed in the chain weren't resubscribed: one
            // subscription each for `pkg` and `pkg/a` over the whole test.
            expect(watcher.watches.filter((watch) => watch.path === ws.path("pkg"))).toHaveLength(1);
            expect(watcher.watches.filter((watch) => watch.path === ws.path("pkg/a"))).toHaveLength(1);
        });

        it("chain grew after subscribing — the collapsed node removes the new folder too", async () => {
            ws.writeFile("pkg/a/x.ts", "");
            const pkg = await pkgNode();
            await provider.getChildren(pkg);
            provider.watchNode(pkg);
            expect(watcher.live()).toEqual([ws.path("pkg"), ws.path("pkg/a")]);

            fs.rmSync(ws.path("pkg/a/x.ts"));
            await provider.getChildren(pkg);
            provider.unwatchNode(pkg);

            expect(watcher.live()).toEqual([]);
        });

        it("re-reading a collapsed node does not subscribe it", async () => {
            const pkg = await pkgNode();
            await provider.getChildren(pkg);
            expect(watcher.live()).toEqual([]);
        });

        it("after unwatchNode re-reading the node does not bring watching back", async () => {
            const pkg = await pkgNode();
            await provider.getChildren(pkg);
            provider.watchNode(pkg);
            provider.unwatchNode(pkg);

            await provider.getChildren(pkg);
            expect(watcher.live()).toEqual([]);
        });

        it("notifications do not throw without a subscriber", async () => {
            vi.useFakeTimers();
            const pkg = await pkgNode();
            await provider.getChildren(pkg);
            provider.watchNode(pkg);

            watcher.watches.find((watch) => watch.path === ws.path("pkg/a/b"))?.fire([ws.path("pkg/a/b/E.java")]);
            watcher.watches.find((watch) => watch.path === ws.path("pkg/a"))?.fire([ws.path("pkg/a/x.ts")]);
            expect(() => vi.advanceTimersByTime(300)).not.toThrow();
        });

        it("unwatchNode without a watch record removes the node's own folders", async () => {
            const pkg = await pkgNode();
            await provider.getChildren(pkg);
            for (const dir of ["pkg", "pkg/a", "pkg/a/b", "README.md"]) provider.watchDirectory(ws.path(dir));

            provider.unwatchNode(pkg);
            expect(watcher.live()).toEqual([ws.path("README.md")]);
        });

        it("change in the last folder — the compact node itself (the row object) is re-read", async () => {
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

        it("change in an intermediate folder breaks the chain and re-reads the head's parent", async () => {
            vi.useFakeTimers();
            fs.mkdirSync(ws.path("outer"));
            fs.renameSync(ws.path("pkg"), ws.path("outer/pkg"));
            fs.mkdirSync(ws.path("outer/other"));
            const outer = (await provider.getChildren()).find((child) => child.name === "outer");
            if (!outer) throw new Error("outer not found");
            const pkg = (await provider.getChildren(outer)).find((child) => child.name === "pkg");
            if (!pkg) throw new Error("pkg not found");
            await provider.getChildren(pkg);
            provider.watchNode(pkg);
            const onChange = vi.fn();
            provider.onChange = onChange;

            const middle = watcher.watches.find((watch) => watch.path === ws.path("outer/pkg/a"));
            middle?.fire([ws.path("outer/pkg/a/x.ts")]);
            vi.advanceTimersByTime(300);

            expect(onChange).toHaveBeenCalledExactlyOnceWith(outer);
            // The chain is forgotten: the next listing builds the node anew.
            expect(provider.keyForPath(ws.path("outer/pkg/a/b"))).toBe(ws.path("outer/pkg/a/b"));
        });

        it("head at the root — a break re-reads the whole tree", async () => {
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

        it("break at the head: the tail below it stays a chain and shows as compact right away", async () => {
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

        it("directory outside chains — its node from the listing is re-read", async () => {
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
