import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { FSWatcher } from "chokidar";
import { describe, expect, it, vi } from "vitest";

import type { ITreeFileChange, ITreeFileWatchOptions } from "../common/iTreeFileWatcher.ts";
import type { LogEntry } from "../../log/common/iLogService.ts";
import { LogLevel } from "../../log/common/logLevel.ts";
import { LogService } from "../../log/common/logService.ts";

import { ChokidarTreeWatcher, isExcluded } from "./chokidarTreeWatcher.ts";

/** Фейковый FSWatcher: обычный EventEmitter + счётчик close(). */
class FakeWatcher extends EventEmitter {
    public closed = 0;
    /** Как настоящий chokidar: событие уходит и именованным слушателям, и в 'all'. */
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

/** Подменяет реальный chokidar фейком через защищённый шов createWatcher. */
class TestTreeWatcher extends ChokidarTreeWatcher {
    public readonly created: FakeWatcher[] = [];
    public readonly options: ITreeFileWatchOptions[] = [];
    protected override createWatcher(_rootPath: string, options: ITreeFileWatchOptions): FSWatcher {
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
    it("коалесцирует всплеск событий в один батч", () => {
        vi.useFakeTimers();
        try {
            const watcher = new TestTreeWatcher();
            const batches: (readonly ITreeFileChange[])[] = [];
            watcher.watchTree("/repo", { recursive: true, excludes: [] }, (changes) => batches.push(changes));

            watcher.created[0].fire("add", "/repo/a.ts");
            watcher.created[0].fire("change", "/repo/b.ts");
            watcher.created[0].fire("unlink", "/repo/c.ts");
            expect(batches).toHaveLength(0); // до истечения окна потребителя не будим

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

    it("каталоги приходят теми же типами, служебные события игнорируются", () => {
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

    it("после dispose батч не доезжает и watcher закрыт", () => {
        vi.useFakeTimers();
        try {
            const watcher = new TestTreeWatcher();
            const batches: (readonly ITreeFileChange[])[] = [];
            const subscription = watcher.watchTree("/repo", { recursive: true, excludes: [] }, (changes) => batches.push(changes));

            watcher.created[0].fire("add", "/repo/a.ts");
            subscription.dispose();
            vi.advanceTimersByTime(50);

            expect(batches).toEqual([]);
            expect(watcher.created[0].closed).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it("переживает 'error' (ENOSPC): закрывает watcher и пишет подсказку в лог", () => {
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

    it("рекурсивность прокидывается в опции chokidar", () => {
        const watcher = new TestTreeWatcher();
        watcher.watchTree("/repo", { recursive: false, excludes: [] }, () => {
            /* no-op */
        });
        expect(watcher.options[0].recursive).toBe(false);
    });
});

describe("ChokidarTreeWatcher — настоящий chokidar", () => {
    /** Единственный тест без подмены `createWatcher`: excludes проверяем на живом обходе. */
    it("в исключённый каталог watcher не заходит, за остальным следит", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "diode-tree-watch-"));
        fs.mkdirSync(path.join(root, "node_modules", "pkg"), { recursive: true });
        fs.mkdirSync(path.join(root, "src"));
        const seen: string[] = [];
        const watcher = new ChokidarTreeWatcher();
        const subscription = watcher.watchTree(
            root,
            { recursive: true, excludes: ["**/node_modules/**"] },
            (changes) => seen.push(...changes.map((c) => c.path)),
        );
        try {
            // Ждём готовности: до события `ready` chokidar считает найденное
            // начальным состоянием и с `ignoreInitial` глотает.
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

describe("isExcluded", () => {
    it("матчит по пути относительно корня", () => {
        expect(isExcluded("/repo", "/repo/node_modules/pkg/index.js", ["**/node_modules/**"])).toBe(true);
        expect(isExcluded("/repo", "/repo/src/index.js", ["**/node_modules/**"])).toBe(false);
    });

    it("сам корень не исключается никогда", () => {
        expect(isExcluded("/repo", "/repo", ["**"])).toBe(false);
    });

    it("пустой набор шаблонов не исключает ничего", () => {
        expect(isExcluded("/repo", "/repo/a.ts", [])).toBe(false);
    });
});
