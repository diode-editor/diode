import { EventEmitter } from "node:events";

import type { ChokidarOptions, FSWatcher } from "chokidar";
import { describe, expect, it } from "vitest";

import type { LogEntry } from "../../log/common/iLogService.ts";
import { LogLevel } from "../../log/common/logLevel.ts";
import { LogService } from "../../log/common/logService.ts";

import { ChokidarFileWatcher } from "./chokidarFileWatcher.ts";

/** Фейковый FSWatcher: обычный EventEmitter + счётчик close() + что ему отдали. */
class FakeWatcher extends EventEmitter {
    public closed = 0;
    public constructor(
        public readonly target: string,
        public readonly options: ChokidarOptions,
    ) {
        super();
    }
    public close(): Promise<void> {
        this.closed++;
        // Как настоящий chokidar: после close() события больше не приходят.
        this.removeAllListeners();
        return Promise.resolve();
    }
}

/**
 * Подменяет реальный chokidar фейком через защищённый шов createWatcher и
 * диск — набором существующих путей (`null` — существует всё).
 */
class TestFileWatcher extends ChokidarFileWatcher {
    public readonly created: FakeWatcher[] = [];
    public existing: Set<string> | null = null;

    protected override createWatcher(target: string, options: ChokidarOptions): FSWatcher {
        const watcher = new FakeWatcher(target, options);
        this.created.push(watcher);
        return watcher as unknown as FSWatcher;
    }

    protected override exists(candidate: string): boolean {
        return this.existing === null || this.existing.has(candidate);
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

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 120));

/** `ignored` chokidar'а как предикат: строка/регэксп фейку не нужны. */
function ignoredBy(options: ChokidarOptions): (candidate: string) => boolean {
    const ignored = options.ignored;
    if (typeof ignored !== "function") throw new Error("expected an `ignored` predicate");
    return (candidate) => ignored(candidate);
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

        // Файл в существующем каталоге — следим за ним самим, без depth/ignored.
        expect(watcher.created[0].target).toBe("/tmp/file.txt");
        expect(watcher.created[0].options).toEqual({ ignoreInitial: true });

        // Всплеск событий атомарной записи (unlink+add) должен схлопнуться в один вызов.
        watcher.created[0].emit("unlink");
        watcher.created[0].emit("add");
        watcher.created[0].emit("change");
        await settle();
        expect(calls).toBe(1);
        // Каталог на месте — атомарная запись watcher не перевешивает.
        expect(watcher.created).toHaveLength(1);

        handle.dispose();
        expect(watcher.created[0].closed).toBe(1);
        watcher.created[0].emit("change");
        await settle();
        expect(calls).toBe(1);
    });

    it("одиночный add (файл создан на месте) — тоже изменение; повторный dispose безопасен", async () => {
        const watcher = new TestFileWatcher();
        let calls = 0;
        const handle = watcher.watchFile("/tmp/file.txt", () => {
            calls++;
        });

        watcher.created[0].emit("add");
        await settle();
        expect(calls).toBe(1);

        handle.dispose();
        expect(() => {
            handle.dispose();
        }).not.toThrow();
    });

    describe("файл без каталога — ждём ближайшего существующего предка", () => {
        it("следит за предком без рекурсии, пропуская только ожидаемый сегмент", () => {
            const watcher = new TestFileWatcher();
            watcher.existing = new Set(["/ws"]);
            watcher.watchFile("/ws/.diode/settings.json", () => {
                /* no-op */
            });

            const [ancestor] = watcher.created;
            expect(ancestor.target).toBe("/ws");
            expect(ancestor.options.ignoreInitial).toBe(true);
            // depth: 0 — соседние каталоги проекта (src, node_modules) не обходятся.
            expect(ancestor.options.depth).toBe(0);
            const ignored = ignoredBy(ancestor.options);
            expect(ignored("/ws")).toBe(false);
            expect(ignored("/ws/.diode")).toBe(false);
            expect(ignored("/ws/src")).toBe(true);
            expect(ignored("/ws/node_modules")).toBe(true);
        });

        it("появился каталог — перевешивается на файл и считает уже лежащий файл изменением", async () => {
            const watcher = new TestFileWatcher();
            watcher.existing = new Set(["/ws"]);
            let calls = 0;
            watcher.watchFile("/ws/.diode/settings.json", () => {
                calls++;
            });

            // `mkdir .diode && echo {} > .diode/settings.json` — к моменту события
            // каталога файл уже лежит, а `ignoreInitial` его бы не отдал.
            watcher.existing.add("/ws/.diode").add("/ws/.diode/settings.json");
            watcher.created[0].emit("addDir", "/ws/.diode");

            expect(watcher.created[0].closed).toBe(1);
            expect(watcher.created[1].target).toBe("/ws/.diode/settings.json");
            expect(watcher.created[1].options).toEqual({ ignoreInitial: true });
            await settle();
            expect(calls).toBe(1);

            watcher.created[1].emit("change");
            await settle();
            expect(calls).toBe(2);
        });

        it("появился пустой каталог — файла нет, изменения нет", async () => {
            const watcher = new TestFileWatcher();
            watcher.existing = new Set(["/ws"]);
            let calls = 0;
            watcher.watchFile("/ws/.diode/settings.json", () => {
                calls++;
            });

            watcher.existing.add("/ws/.diode");
            watcher.created[0].emit("addDir", "/ws/.diode");
            await settle();

            expect(watcher.created[1].target).toBe("/ws/.diode/settings.json");
            expect(calls).toBe(0);
        });

        it("нескольких уровней нет — ждёт их по одному", () => {
            const watcher = new TestFileWatcher();
            watcher.existing = new Set(["/ws"]);
            watcher.watchFile("/ws/a/b/settings.json", () => {
                /* no-op */
            });

            expect(watcher.created[0].target).toBe("/ws");
            expect(ignoredBy(watcher.created[0].options)("/ws/a")).toBe(false);

            watcher.existing.add("/ws/a");
            watcher.created[0].emit("addDir", "/ws/a");
            // Следующий недостающий сегмент — `/ws/a/b` под `/ws/a`.
            expect(watcher.created[1].target).toBe("/ws/a");
            expect(watcher.created[1].options.depth).toBe(0);
            expect(ignoredBy(watcher.created[1].options)("/ws/a/b")).toBe(false);
            expect(ignoredBy(watcher.created[1].options)("/ws/a/other")).toBe(true);
        });

        it("каталог снесли целиком — после unlink снова ждёт каталог", async () => {
            const watcher = new TestFileWatcher();
            watcher.existing = new Set(["/ws", "/ws/.diode"]);
            let calls = 0;
            watcher.watchFile("/ws/.diode/settings.json", () => {
                calls++;
            });
            expect(watcher.created[0].target).toBe("/ws/.diode/settings.json");

            // `rm -rf .diode`: unlink файла, и каталога больше нет.
            watcher.existing.delete("/ws/.diode");
            watcher.created[0].emit("unlink");
            await settle();

            expect(calls).toBe(1); // потребитель перечитает (слой станет пустым)
            expect(watcher.created[0].closed).toBe(1);
            expect(watcher.created[1].target).toBe("/ws");
            expect(watcher.created[1].options.depth).toBe(0);
        });

        it("не существует ничего — ждёт у корня ФС, а не крутится вечно", () => {
            const watcher = new TestFileWatcher();
            watcher.existing = new Set();
            watcher.watchFile("/a/b/settings.json", () => {
                /* no-op */
            });

            expect(watcher.created[0].target).toBe("/");
            expect(ignoredBy(watcher.created[0].options)("/a")).toBe(false);
        });

        it("dispose в режиме ожидания закрывает watcher предка", () => {
            const watcher = new TestFileWatcher();
            watcher.existing = new Set(["/ws"]);
            const handle = watcher.watchFile("/ws/.diode/settings.json", () => {
                /* no-op */
            });

            handle.dispose();
            expect(watcher.created[0].closed).toBe(1);
        });
    });
});
