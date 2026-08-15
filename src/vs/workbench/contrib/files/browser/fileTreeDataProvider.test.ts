import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";

import { FileTreeDataProvider } from "./fileTreeDataProvider.ts";

describe("FileTreeDataProvider", () => {
    let ws: ITempWorkspace;
    let provider: FileTreeDataProvider;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-test-" });
        provider = new FileTreeDataProvider(ws.dir);
    });

    afterEach(() => {
        provider.dispose();
        ws.dispose();
    });

    describe("getChildren", () => {
        it("returns files and directories from root", () => {
            ws.writeFile("file.ts", "");
            fs.mkdirSync(ws.path("src"));

            const children = provider.getChildren();
            expect(children).toHaveLength(2);
        });

        it("sorts directories before files", () => {
            ws.writeFile("b.ts", "");
            fs.mkdirSync(ws.path("aDir"));
            ws.writeFile("a.ts", "");

            const children = provider.getChildren();
            expect(children[0].name).toBe("aDir");
            expect(children[0].isDirectory).toBe(true);
            expect(children[1].name).toBe("a.ts");
            expect(children[2].name).toBe("b.ts");
        });

        it("sorts files alphabetically", () => {
            ws.writeFile("z.ts", "");
            ws.writeFile("a.ts", "");
            ws.writeFile("m.ts", "");

            const children = provider.getChildren();
            expect(children.map((c) => c.name)).toEqual(["a.ts", "m.ts", "z.ts"]);
        });

        it("excludes node_modules and .git", () => {
            fs.mkdirSync(ws.path("node_modules"));
            fs.mkdirSync(ws.path(".git"));
            ws.writeFile("index.ts", "");

            const children = provider.getChildren();
            expect(children).toHaveLength(1);
            expect(children[0].name).toBe("index.ts");
        });

        it("returns children of a subdirectory", () => {
            const subDir = ws.path("src");
            ws.writeFile("src/main.ts", "");
            ws.writeFile("src/util.ts", "");

            const dirNode = { name: "src", path: subDir, isDirectory: true };
            const children = provider.getChildren(dirNode);
            expect(children).toHaveLength(2);
            expect(children.map((c) => c.name)).toEqual(["main.ts", "util.ts"]);
        });

        it("returns empty array for empty directory", () => {
            const subDir = ws.path("empty");
            fs.mkdirSync(subDir);

            const dirNode = { name: "empty", path: subDir, isDirectory: true };
            expect(provider.getChildren(dirNode)).toEqual([]);
        });

        it("returns empty array for non-existent directory", () => {
            const dirNode = { name: "nope", path: ws.path("nope"), isDirectory: true };
            expect(provider.getChildren(dirNode)).toEqual([]);
        });

        it("orders files after directories for a dir/file/dir name sequence (sort branch 119)", () => {
            // readdir yields these alphabetically as [a-dir, b-file, c-dir] — a
            // dir/file/dir sequence that drives the comparator down BOTH the
            // `-1` (dir before file) and `1` (file after dir) paths.
            fs.mkdirSync(ws.path("a-dir"));
            ws.writeFile("b-file.ts", "");
            fs.mkdirSync(ws.path("c-dir"));

            const children = provider.getChildren();
            // Directories first (sorted), then the file.
            expect(children.map((c) => c.name)).toEqual(["a-dir", "c-dir", "b-file.ts"]);
            expect(children.map((c) => c.isDirectory)).toEqual([true, true, false]);
        });
    });

    describe("symlinks", () => {
        it("marks a symlink to a file as a symbolic link, not a directory", () => {
            ws.writeFile("target.ts", "");
            fs.symlinkSync(ws.path("target.ts"), ws.path("link.ts"));

            const children = provider.getChildren();
            const link = children.find((c) => c.name === "link.ts");
            expect(link).toBeDefined();
            expect(link?.isSymbolicLink).toBe(true);
            expect(link?.isDirectory).toBe(false);
        });

        it("resolves a symlink to a directory as a directory", () => {
            fs.mkdirSync(ws.path("realDir"));
            fs.symlinkSync(ws.path("realDir"), ws.path("linkDir"));

            const children = provider.getChildren();
            const link = children.find((c) => c.name === "linkDir");
            expect(link?.isSymbolicLink).toBe(true);
            expect(link?.isDirectory).toBe(true);
        });

        it("treats a broken symlink as a non-directory file", () => {
            fs.symlinkSync(ws.path("does-not-exist"), ws.path("broken"));

            const children = provider.getChildren();
            const link = children.find((c) => c.name === "broken");
            expect(link?.isSymbolicLink).toBe(true);
            expect(link?.isDirectory).toBe(false);
        });

        it("flags a symlinked file while keeping its normal type icon", () => {
            const node = { name: "link.ts", path: "/link.ts", isDirectory: false, isSymbolicLink: true };
            const item = provider.getTreeItem(node);
            expect(item.symlink).toBe(true);
            // The type icon is preserved — same as a non-symlink .ts file (icon not hidden).
            const plain = provider.getTreeItem({ name: "link.ts", path: "/link.ts", isDirectory: false });
            expect(item.icon).toBe(plain.icon);
            expect(item.iconColor).toBe(plain.iconColor);
        });

        it("flags a symlinked directory and keeps it collapsible", () => {
            const node = { name: "linkDir", path: "/linkDir", isDirectory: true, isSymbolicLink: true };
            const item = provider.getTreeItem(node);
            expect(item.collapsible).toBe(true);
            expect(item.symlink).toBe(true);
        });

        it("does not flag a regular file or directory as a symlink", () => {
            const file = provider.getTreeItem({ name: "main.ts", path: "/main.ts", isDirectory: false });
            const dir = provider.getTreeItem({ name: "src", path: "/src", isDirectory: true });
            expect(file.symlink).toBeFalsy();
            expect(dir.symlink).toBeFalsy();
        });
    });

    describe("getKey", () => {
        it("returns the file path as key", () => {
            const node = { name: "test.ts", path: "/some/path/test.ts", isDirectory: false };
            expect(provider.getKey(node)).toBe("/some/path/test.ts");
        });
    });

    describe("getTreeItem", () => {
        it("marks directories as collapsible", () => {
            const node = { name: "src", path: "/src", isDirectory: true };
            const item = provider.getTreeItem(node);
            expect(item.collapsible).toBe(true);
            expect(item.label).toBe("src");
        });

        it("marks files as non-collapsible", () => {
            const node = { name: "main.ts", path: "/main.ts", isDirectory: false };
            const item = provider.getTreeItem(node);
            expect(item.collapsible).toBe(false);
        });

        it("provides icon for known file types", () => {
            const node = { name: "main.ts", path: "/main.ts", isDirectory: false };
            const item = provider.getTreeItem(node);
            expect(item.icon).toBeDefined();
            expect(item.iconColor).toBeDefined();
        });

        it("does not provide icon for directories", () => {
            const node = { name: "src", path: "/src", isDirectory: true };
            const item = provider.getTreeItem(node);
            expect(item.icon).toBeUndefined();
            expect(item.iconColor).toBeUndefined();
        });
    });

    describe("git status decorations", () => {
        it("has no decoration by default", () => {
            const item = provider.getTreeItem({ name: "main.ts", path: "/main.ts", isDirectory: false });
            expect(item.labelColor).toBeUndefined();
            expect(item.badge).toBeUndefined();
        });

        it("maps a status entry onto the tree item by absolute path", () => {
            provider.setGitStatus(new Map([["/main.ts", { color: 0x73c991, badge: "M" }]]));

            const decorated = provider.getTreeItem({ name: "main.ts", path: "/main.ts", isDirectory: false });
            expect(decorated.labelColor).toBe(0x73c991);
            expect(decorated.badge).toBe("M");

            // A file not present in the status map stays undecorated.
            const plain = provider.getTreeItem({ name: "other.ts", path: "/other.ts", isDirectory: false });
            expect(plain.labelColor).toBeUndefined();
            expect(plain.badge).toBeUndefined();
        });

        it("decorates directories as well as files", () => {
            provider.setGitStatus(new Map([["/src", { color: 0xe2c08d, badge: "U" }]]));

            const dir = provider.getTreeItem({ name: "src", path: "/src", isDirectory: true });
            expect(dir.collapsible).toBe(true);
            expect(dir.labelColor).toBe(0xe2c08d);
            expect(dir.badge).toBe("U");
        });

        it("replaces the whole status map on each call", () => {
            provider.setGitStatus(new Map([["/a.ts", { color: 0x111111, badge: "A" }]]));
            provider.setGitStatus(new Map([["/b.ts", { color: 0x222222, badge: "M" }]]));

            expect(provider.getTreeItem({ name: "a.ts", path: "/a.ts", isDirectory: false }).badge).toBeUndefined();
            expect(provider.getTreeItem({ name: "b.ts", path: "/b.ts", isDirectory: false }).badge).toBe("M");
        });

        it("supports a colour-only or badge-only entry", () => {
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
            expect(badgeOnly.badge).toBe("M");
        });
    });

    describe("file watching", () => {
        it("notifies onChange when a file is created in watched directory", async () => {
            const callback = vi.fn();
            provider.onChange = callback;

            provider.watchDirectory(ws.dir);

            // Wait for chokidar to be ready
            await new Promise((r) => setTimeout(r, 500));

            // Create a file in the watched directory
            ws.writeFile("new-file.ts", "");

            // Wait for debounce (300ms) + buffer
            await new Promise((r) => setTimeout(r, 1000));

            expect(callback).toHaveBeenCalled();
        }, 5000);

        it("does not notify after unwatch", async () => {
            const callback = vi.fn();
            provider.onChange = callback;

            provider.watchDirectory(ws.dir);
            provider.unwatchDirectory(ws.dir);

            ws.writeFile("new-file.ts", "");

            await new Promise((r) => setTimeout(r, 500));

            expect(callback).not.toHaveBeenCalled();
        });

        it("does not duplicate watchers for the same directory", () => {
            provider.watchDirectory(ws.dir);
            provider.watchDirectory(ws.dir); // second call should be no-op
            // No error thrown — test passes
            provider.unwatchDirectory(ws.dir);
        });

        it("cleans up watchers on dispose", async () => {
            const callback = vi.fn();
            provider.onChange = callback;

            provider.watchDirectory(ws.dir);
            provider.dispose();

            ws.writeFile("new-file.ts", "");

            await new Promise((r) => setTimeout(r, 500));

            expect(callback).not.toHaveBeenCalled();
        });

        it("unwatchDirectory on a directory that was never watched is a no-op (branch 76)", () => {
            expect(() => {
                provider.unwatchDirectory(ws.path("never-watched"));
            }).not.toThrow();
        });

        it("survives a watcher 'error' (e.g. ENOSPC) instead of crashing", async () => {
            // Регрессия на исходный краш: chokidar при исчерпании лимита inotify делает
            // emit('error'); без слушателя 'error' EventEmitter бросил бы исключение из
            // своих async-потрохов, оно всплыло бы как unhandledRejection и убило процесс.
            const onWatchError = vi.fn();
            provider.onWatchError = onWatchError;

            provider.watchDirectory(ws.dir);
            await new Promise((r) => setTimeout(r, 300)); // дать chokidar устояться

            const watchers = (
                provider as unknown as {
                    watchers: Map<string, { emit(event: string, ...args: unknown[]): boolean }>;
                }
            ).watchers;
            const watcher = watchers.get(ws.dir);
            expect(watcher).toBeDefined();

            const err = Object.assign(new Error("ENOSPC: watch limit reached"), { code: "ENOSPC" });

            // Эмит 'error' НЕ должен бросать (иначе — краш процесса).
            expect(() => watcher?.emit("error", err)).not.toThrow();

            // Ошибка проброшена наверх с путём каталога и объектом ошибки.
            expect(onWatchError).toHaveBeenCalledWith(ws.dir, err);

            // Неудавшийся watcher убран из карты — повторное раскрытие сможет попробовать снова.
            expect(watchers.has(ws.dir)).toBe(false);
        });
    });

    describe("debounce timer lifecycle", () => {
        /** Wait until a 300ms debounce timer has been scheduled by debouncedNotify. */
        async function waitForPendingDebounce(spy: { mock: { calls: unknown[][] } }): Promise<void> {
            await vi.waitFor(
                () => {
                    const scheduled = spy.mock.calls.some((call: unknown[]) => call[1] === 300);
                    expect(scheduled).toBe(true);
                },
                { interval: 10, timeout: 4000 },
            );
        }

        it("clears a pending debounce timer when its directory is unwatched (lines 83-84, branch 82)", async () => {
            const callback = vi.fn();
            provider.onChange = callback;
            provider.watchDirectory(ws.dir);
            // Wait for chokidar to settle before emitting an event.
            await new Promise((r) => setTimeout(r, 500));

            const setSpy = vi.spyOn(globalThis, "setTimeout");
            const clearSpy = vi.spyOn(globalThis, "clearTimeout");

            // Trigger a watcher event → debouncedNotify schedules a 300ms timer.
            ws.writeFile("trigger.ts", "");
            await waitForPendingDebounce(setSpy);

            const clearsBefore = clearSpy.mock.calls.length;
            // Unwatching while the debounce timer is pending must clear it (lines 83-84).
            provider.unwatchDirectory(ws.dir);
            expect(clearSpy.mock.calls.length).toBeGreaterThan(clearsBefore);

            // The cleared timer must never fire onChange.
            await new Promise((r) => setTimeout(r, 400));
            expect(callback).not.toHaveBeenCalled();

            setSpy.mockRestore();
            clearSpy.mockRestore();
        }, 8000);

        it("clears pending debounce timers on dispose (line 94)", async () => {
            const callback = vi.fn();
            provider.onChange = callback;
            provider.watchDirectory(ws.dir);
            await new Promise((r) => setTimeout(r, 500));

            const setSpy = vi.spyOn(globalThis, "setTimeout");
            const clearSpy = vi.spyOn(globalThis, "clearTimeout");

            ws.writeFile("trigger.ts", "");
            await waitForPendingDebounce(setSpy);

            const clearsBefore = clearSpy.mock.calls.length;
            provider.dispose();
            // dispose() iterates pending debounce timers and clears them (line 94).
            expect(clearSpy.mock.calls.length).toBeGreaterThan(clearsBefore);

            await new Promise((r) => setTimeout(r, 400));
            expect(callback).not.toHaveBeenCalled();

            setSpy.mockRestore();
            clearSpy.mockRestore();
        }, 8000);

        it("collapses back-to-back events into one notification (debounce reset, branch 128)", async () => {
            const callback = vi.fn();
            provider.onChange = callback;
            provider.watchDirectory(ws.dir);
            await new Promise((r) => setTimeout(r, 500));

            // Several rapid events: each subsequent debouncedNotify sees an existing
            // timer and clears it before re-scheduling (branch 128 true path).
            ws.writeFile("one.ts", "");
            ws.writeFile("two.ts", "");
            ws.writeFile("three.ts", "");
            await new Promise((r) => setTimeout(r, 100));
            ws.writeFile("four.ts", "");
            ws.writeFile("five.ts", "");

            // Wait past the debounce window for the coalesced notification.
            await new Promise((r) => setTimeout(r, 800));

            expect(callback).toHaveBeenCalled();
        }, 8000);
    });
});
