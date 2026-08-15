import { EventEmitter } from "node:events";

import type { FSWatcher } from "chokidar";
import { describe, expect, it } from "vitest";

import type { LogEntry } from "../../log/common/iLogService.ts";
import { LogLevel } from "../../log/common/logLevel.ts";
import { LogService } from "../../log/common/logService.ts";

import { ChokidarFileWatcher } from "./chokidarFileWatcher.ts";

/** Фейковый FSWatcher: обычный EventEmitter + счётчик close(). */
class FakeWatcher extends EventEmitter {
    public closed = 0;
    public close(): Promise<void> {
        this.closed++;
        // Как настоящий chokidar: после close() события больше не приходят.
        this.removeAllListeners();
        return Promise.resolve();
    }
}

/** Подменяет реальный chokidar фейком через защищённый шов createWatcher. */
class TestFileWatcher extends ChokidarFileWatcher {
    public readonly created: FakeWatcher[] = [];
    protected override createWatcher(): FSWatcher {
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

describe("ChokidarFileWatcher", () => {
    it("survives a watcher 'error' (ENOSPC) instead of crashing the process", () => {
        // Регрессия на исходный краш: без слушателя 'error' EventEmitter chokidar'а
        // бросает исключение из своих async-потрохов — процесс падает целиком.
        const watcher = new TestFileWatcher();
        watcher.watchFile("/home/user/.diode/user-data/User/settings.json", () => {
            /* no-op */
        });
        const err = Object.assign(new Error("ENOSPC: System limit for number of file watchers reached"), {
            code: "ENOSPC",
        });

        expect(() => watcher.created[0].emit("error", err)).not.toThrow();
        // Мёртвый watcher закрыт — не держим ресурс, живём без live-reload этого файла.
        expect(watcher.created[0].closed).toBe(1);
    });

    it("logs a warn with an inotify hint for ENOSPC", () => {
        const { logService, entries } = createLogService();
        const watcher = new TestFileWatcher(logService.createLogger("files.watcher"));
        const filePath = "/home/user/.diode/user-data/User/settings.json";
        watcher.watchFile(filePath, () => {
            /* no-op */
        });

        watcher.created[0].emit("error", Object.assign(new Error("ENOSPC"), { code: "ENOSPC" }));

        expect(entries).toHaveLength(1);
        expect(entries[0].channel).toBe("files.watcher");
        expect(entries[0].message).toContain("increase fs.inotify.max_user_watches");
        expect(entries[0].args[0]).toMatchObject({ filePath, code: "ENOSPC" });
    });

    it("logs other watcher errors without the tuning hint", () => {
        const { logService, entries } = createLogService();
        const watcher = new TestFileWatcher(logService.createLogger("files.watcher"));
        watcher.watchFile("/etc/shadow", () => {
            /* no-op */
        });

        watcher.created[0].emit("error", Object.assign(new Error("EACCES"), { code: "EACCES" }));

        expect(entries).toHaveLength(1);
        expect(entries[0].message).not.toContain("max_user_watches");
        expect(entries[0].args[0]).toMatchObject({ code: "EACCES" });
    });

    it("debounces change events and stops notifying after dispose", async () => {
        const watcher = new TestFileWatcher();
        let calls = 0;
        const handle = watcher.watchFile("/tmp/file.txt", () => {
            calls++;
        });

        // Всплеск событий атомарной записи (unlink+add) должен схлопнуться в один вызов.
        watcher.created[0].emit("unlink");
        watcher.created[0].emit("add");
        watcher.created[0].emit("change");
        await new Promise((r) => setTimeout(r, 120));
        expect(calls).toBe(1);

        handle.dispose();
        expect(watcher.created[0].closed).toBe(1);
        watcher.created[0].emit("change");
        await new Promise((r) => setTimeout(r, 120));
        expect(calls).toBe(1);
    });
});
