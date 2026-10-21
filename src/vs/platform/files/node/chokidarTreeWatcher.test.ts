import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { FSWatcher } from "chokidar";
import { describe, expect, it, vi } from "vitest";

import type { LogEntry } from "../../log/common/iLogService.ts";
import { LogLevel } from "../../log/common/logLevel.ts";
import { LogService } from "../../log/common/logService.ts";
import type { ITreeFileChange, ITreeFileWatchOptions } from "../common/iTreeFileWatcher.ts";

import { ChokidarTreeWatcher, isExcluded } from "./chokidarTreeWatcher.ts";

class FakeWatcher extends EventEmitter {
    public closed = 0;
    /** Like real chokidar: an event goes both to named listeners and to 'all'. */
    public fire(event: string, ...args: unknown[]): void {
        this.emit(event, ...args);
        this.emit("all", event, ...args);
    }

    public close(): Promise<void> {
        this.closed++;
        this.removeAllListeners();
        return Promise.resolve();
    }
}

class TestTreeWatcher extends ChokidarTreeWatcher {
    public readonly created: FakeWatcher[] = [];
    public readonly options: ITreeFileWatchOptions[] = [];
    public readonly roots: string[] = [];
    protected override createWatcher(rootPath: string, options: ITreeFileWatchOptions): FSWatcher {
        this.roots.push(rootPath);
        this.options.push(options);
        const watcher = new FakeWatcher();
        this.created.push(watcher);
        return watcher as unknown as FSWatcher;
    }
}

function createLogService(): { logService: LogService; entries: LogEntry[] } {
    const logService = new LogService();
    logService.setLevel("*", LogLevel.Trace);
    const entries: LogEntry[] = [];
    logService.addSink({
        append: (entry) => entries.push(entry),
        dispose: () => {
            /* no-op */
        },
    });
    return { logService, entries };
}

describe("ChokidarTreeWatcher", () => {
    it("coalesces a burst of events into one batch", () => {
        vi.useFakeTimers();
        try {
            const watcher = new TestTreeWatcher();
            const batches: (readonly ITreeFileChange[])[] = [];
            watcher.watchTree("/repo", { recursive: true, excludes: [] }, (changes) => batches.push(changes));

            watcher.created[0].fire("add", "/repo/a.ts");
            watcher.created[0].fire("change", "/repo/b.ts");
            watcher.created[0].fire("unlink", "/repo/c.ts");
            expect(batches).toHaveLength(0); // the consumer isn't woken before the window expires

            vi.advanceTimersByTime(50);
            expect(batches).toEqual([
                [
                    { type: "created", path: "/repo/a.ts" },
                    { type: "changed", path: "/repo/b.ts" },
                    { type: "deleted", path: "/repo/c.ts" },
                ],
            ]);
        } finally {
            vi.useRealTimers();
        }
    });

    it("directories come with the same types, service events are ignored", () => {
        vi.useFakeTimers();
        try {
            const watcher = new TestTreeWatcher();
            const batches: (readonly ITreeFileChange[])[] = [];
            watcher.watchTree("/repo", { recursive: true, excludes: [] }, (changes) => batches.push(changes));

            watcher.created[0].fire("ready");
            watcher.created[0].fire("raw", "moved", "x", {});
            watcher.created[0].fire("addDir", "/repo/dir");
            watcher.created[0].fire("unlinkDir", "/repo/gone");
            vi.advanceTimersByTime(50);

            expect(batches).toEqual([
                [
                    { type: "created", path: "/repo/dir" },
                    { type: "deleted", path: "/repo/gone" },
                ],
            ]);
        } finally {
            vi.useRealTimers();
        }
    });

    it("after dispose the batch is not delivered and the watcher is closed", () => {
        vi.useFakeTimers();
        try {
            const watcher = new TestTreeWatcher();
            const batches: (readonly ITreeFileChange[])[] = [];
            const subscription = watcher.watchTree("/repo", { recursive: true, excludes: [] }, (changes) =>
                batches.push(changes),
            );

            watcher.created[0].fire("add", "/repo/a.ts");
            subscription.dispose();
            vi.advanceTimersByTime(50);

            expect(batches).toEqual([]);
            expect(watcher.created[0].closed).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it("survives 'error' (ENOSPC): closes the watcher and logs a hint", () => {
        const { logService, entries } = createLogService();
        const watcher = new TestTreeWatcher(logService.createLogger("files.watcher"));
        watcher.watchTree("/repo", { recursive: true, excludes: [] }, () => {
            /* no-op */
        });
        const err = Object.assign(new Error("ENOSPC: System limit for number of file watchers reached"), {
            code: "ENOSPC",
        });

        expect(() => watcher.created[0].emit("error", err)).not.toThrow();
        expect(watcher.created[0].closed).toBe(1);
        expect(entries.at(-1)?.message).toContain("max_user_watches");
    });

    it("an initial symlink `add` before `ready` is suppressed, after it is delivered", () => {
        vi.useFakeTimers();
        try {
            const watcher = new TestTreeWatcher();
            const batches: (readonly ITreeFileChange[])[] = [];
            watcher.watchTree("/repo", { recursive: true, excludes: [] }, (changes) => batches.push(changes));
            const link = { isSymbolicLink: () => true };
            const file = { isSymbolicLink: () => false };

            watcher.created[0].fire("add", "/repo/bazel-out", link); // initial scan, not a change
            watcher.created[0].fire("unlink", "/repo/gone", link); // not `add`: delivered even before `ready`
            watcher.created[0].fire("add", "/repo/early.ts", file); // not a symlink: delivered
            watcher.created[0].fire("ready");
            watcher.created[0].fire("add", "/repo/bazel-bin", link); // created after startup
            vi.advanceTimersByTime(50);

            expect(batches).toEqual([
                [
                    { type: "deleted", path: "/repo/gone" },
                    { type: "created", path: "/repo/early.ts" },
                    { type: "created", path: "/repo/bazel-bin" },
                ],
            ]);
        } finally {
            vi.useRealTimers();
        }
    });

    it("symlink root: chokidar gets the real path, events come under the original one", () => {
        const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "diode-tree-root-")));
        const real = path.join(base, "real");
        const link = path.join(base, "link");
        fs.mkdirSync(real);
        fs.symlinkSync(real, link, "junction");
        vi.useFakeTimers();
        try {
            const watcher = new TestTreeWatcher();
            const batches: (readonly ITreeFileChange[])[] = [];
            watcher.watchTree(link, { recursive: true, excludes: [] }, (changes) => batches.push(changes));
            expect(watcher.roots).toEqual([real]);

            watcher.created[0].fire("add", path.join(real, "a.ts"));
            vi.advanceTimersByTime(50);
            expect(batches).toEqual([[{ type: "created", path: path.join(link, "a.ts") }]]);
        } finally {
            vi.useRealTimers();
            fs.rmSync(base, { recursive: true, force: true });
        }
    });

    it("recursiveness is passed into the chokidar options", () => {
        const watcher = new TestTreeWatcher();
        watcher.watchTree("/repo", { recursive: false, excludes: [] }, () => {
            /* no-op */
        });
        expect(watcher.options[0].recursive).toBe(false);
    });
});

describe("ChokidarTreeWatcher — real chokidar", () => {
    /** The only test without a stubbed `createWatcher`: excludes are checked on a live traversal. */
    it("the watcher does not enter an excluded directory and watches the rest", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "diode-tree-watch-"));
        fs.mkdirSync(path.join(root, "node_modules", "pkg"), { recursive: true });
        fs.mkdirSync(path.join(root, "src"));
        const seen: string[] = [];
        const watcher = new ChokidarTreeWatcher();
        const subscription = watcher.watchTree(root, { recursive: true, excludes: ["**/node_modules/**"] }, (changes) =>
            seen.push(...changes.map((c) => c.path)),
        );
        try {
            // Before `ready` chokidar with `ignoreInitial` swallows what it finds, so wait.
            await new Promise((resolve) => setTimeout(resolve, 400));

            fs.writeFileSync(path.join(root, "node_modules", "pkg", "index.js"), "x");
            fs.writeFileSync(path.join(root, "src", "a.ts"), "y");
            await new Promise((resolve) => setTimeout(resolve, 800));

            expect(seen).toContain(path.join(root, "src", "a.ts"));
            expect(seen.filter((p) => p.includes("node_modules"))).toEqual([]);
        } finally {
            subscription.dispose();
            fs.rmSync(root, { recursive: true, force: true });
        }
    }, 20000);
});

describe("ChokidarTreeWatcher — symlinks (like upstream parcel-watcher)", () => {
    /** Waits until `expected` shows up in `seen` (a positive marker instead of a blind pause). */
    async function waitFor(seen: readonly string[], expected: string): Promise<void> {
        const deadline = Date.now() + 10000;
        while (!seen.includes(expected)) {
            if (Date.now() > deadline)
                throw new Error(`timed out waiting for event ${expected}; got: ${seen.join(", ")}`);
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
    }

    /** `junction` is a link that needs no admin rights on Windows; on POSIX the type is ignored. */
    function makeTree(): { base: string; root: string; outside: string } {
        const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "diode-tree-link-")));
        const root = path.join(base, "ws");
        const outside = path.join(base, "cache");
        fs.mkdirSync(path.join(root, "src"), { recursive: true });
        fs.mkdirSync(path.join(outside, "pkg"), { recursive: true });
        return { base, root, outside };
    }

    it("does not enter a directory symlink inside the tree (bazel-out → cache outside the workspace)", async () => {
        const { base, root, outside } = makeTree();
        fs.symlinkSync(outside, path.join(root, "bazel-out"), "junction");
        const seen: string[] = [];
        const subscription = new ChokidarTreeWatcher().watchTree(root, { recursive: true, excludes: [] }, (changes) =>
            seen.push(...changes.map((c) => c.path)),
        );
        try {
            await new Promise((resolve) => setTimeout(resolve, 400)); // `ready`, see the test above

            fs.writeFileSync(path.join(outside, "pkg", "BUILD.bazel"), "x");
            const marker = path.join(root, "src", "BUILD.bazel");
            fs.writeFileSync(marker, "y");
            await waitFor(seen, marker);

            expect(seen.filter((p) => p.includes("bazel-out"))).toEqual([]);
        } finally {
            subscription.dispose();
            fs.rmSync(base, { recursive: true, force: true });
        }
    }, 20000);

    it("a symlink root is resolved, events come under the original path", async () => {
        const { base, root } = makeTree();
        const linkedRoot = path.join(base, "ws-link");
        fs.symlinkSync(root, linkedRoot, "junction");
        const seen: string[] = [];
        const subscription = new ChokidarTreeWatcher().watchTree(
            linkedRoot,
            { recursive: true, excludes: ["**/ignored"] },
            (changes) => seen.push(...changes.map((c) => c.path)),
        );
        try {
            await new Promise((resolve) => setTimeout(resolve, 400));

            fs.mkdirSync(path.join(root, "ignored"));
            fs.writeFileSync(path.join(root, "ignored", "a.ts"), "x");
            fs.writeFileSync(path.join(root, "src", "a.ts"), "y");
            const expected = path.join(linkedRoot, "src", "a.ts");
            await waitFor(seen, expected);

            // All paths are under the original root, and excludes are anchored to it too.
            expect(seen.every((p) => p.startsWith(linkedRoot + path.sep))).toBe(true);
            expect(seen.filter((p) => p.includes("ignored"))).toEqual([]);
        } finally {
            subscription.dispose();
            fs.rmSync(base, { recursive: true, force: true });
        }
    }, 20000);
});

describe("isExcluded", () => {
    it("matches by the path relative to the root", () => {
        expect(isExcluded("/repo", "/repo/node_modules/pkg/index.js", ["**/node_modules/**"])).toBe(true);
        expect(isExcluded("/repo", "/repo/src/index.js", ["**/node_modules/**"])).toBe(false);
    });

    it("the root itself is never excluded", () => {
        expect(isExcluded("/repo", "/repo", ["**"])).toBe(false);
    });

    it("an empty pattern set excludes nothing", () => {
        expect(isExcluded("/repo", "/repo/a.ts", [])).toBe(false);
    });
});
