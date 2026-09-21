import { describe, expect, it } from "vitest";

import type { LogEntry } from "../../log/common/iLogService.ts";
import { LogLevel } from "../../log/common/logLevel.ts";
import { LogService } from "../../log/common/logService.ts";
import type { ITreeFileChange } from "../common/iTreeFileWatcher.ts";

import type { IWatcherProcess } from "./subprocessTreeWatcher.ts";
import { SubprocessTreeWatcher } from "./subprocessTreeWatcher.ts";
import type { ITreeWatcherRequest, ITreeWatcherResponse } from "./treeWatcherProtocol.ts";

/** Watcher-процесс без процесса: сообщения копятся, смерть и ответы — руками. */
class FakeProcess implements IWatcherProcess {
    public readonly sent: ITreeWatcherRequest[] = [];
    public kills = 0;
    private messageListener: ((message: unknown) => void) | null = null;
    private exitListener: (() => void) | null = null;
    private errorListener: ((error: unknown) => void) | null = null;

    public send(message: ITreeWatcherRequest): void {
        this.sent.push(message);
    }

    public onMessage(listener: (message: unknown) => void): void {
        this.messageListener = listener;
    }

    public onExit(listener: () => void): void {
        this.exitListener = listener;
    }

    public onError(listener: (error: unknown) => void): void {
        this.errorListener = listener;
    }

    public kill(): void {
        this.kills++;
        this.die();
    }

    /** Прислать сообщение хосту, как это сделал бы настоящий процесс. */
    public emit(message: unknown): void {
        this.messageListener?.(message);
    }

    /** Умереть — сам (падение) или от `kill()`. */
    public die(): void {
        this.exitListener?.();
    }

    /** Не подняться или сломать канал: `error` вместо (или до) `exit`. */
    public fail(error: unknown): void {
        this.errorListener?.(error);
    }
}

/** Фабрика процессов с журналом: сколько раз и какие из них подняли. */
function processFactory(): { spawnProcess: () => IWatcherProcess; spawned: FakeProcess[] } {
    const spawned: FakeProcess[] = [];
    return {
        spawnProcess: () => {
            const child = new FakeProcess();
            spawned.push(child);
            return child;
        },
        spawned,
    };
}

function createLogService(): { logService: LogService; entries: LogEntry[] } {
    const logService = new LogService();
    logService.setLevel("*", LogLevel.Trace);
    const entries: LogEntry[] = [];
    logService.addSink({ append: (entry) => entries.push(entry), dispose: () => undefined });
    return { logService, entries };
}

const OPTIONS = { recursive: true, excludes: [] as readonly string[] };
const CHANGES: readonly ITreeFileChange[] = [{ type: "changed", path: "/repo/a.ts" }];

describe("SubprocessTreeWatcher", () => {
    it("не поднимает процесс, пока следить никто не просил", () => {
        const { spawnProcess, spawned } = processFactory();

        new SubprocessTreeWatcher({ spawnProcess });

        // Спавн на старте вернул бы задержку на критический путь запуска — ровно
        // то, ради ухода от чего обход и переехал.
        expect(spawned).toHaveLength(0);
    });

    it("первый watchTree поднимает процесс и отправляет туда запрос", () => {
        const { logService, entries } = createLogService();
        const { spawnProcess, spawned } = processFactory();
        const watcher = new SubprocessTreeWatcher({ spawnProcess, logger: logService.createLogger("files.watcher") });

        watcher.watchTree("/repo", { recursive: true, excludes: ["**/node_modules"] }, () => undefined);

        expect(spawned).toHaveLength(1);
        expect(spawned[0]?.sent).toEqual([
            { t: "watch", id: 1, rootPath: "/repo", options: { recursive: true, excludes: ["**/node_modules"] } },
        ]);
        // Подъём процесса виден в логе: иначе «почему их два» разбирать нечем.
        expect(entries.map((e) => e.message)).toContain("spawning file watcher process");
    });

    it("второй запрос едет в тот же процесс со своим id", () => {
        const { spawnProcess, spawned } = processFactory();
        const watcher = new SubprocessTreeWatcher({ spawnProcess });

        watcher.watchTree("/repo", OPTIONS, () => undefined);
        watcher.watchTree("/repo/.git", { recursive: false, excludes: [] }, () => undefined);

        expect(spawned).toHaveLength(1);
        expect(spawned[0]?.sent.map((m) => m.id)).toEqual([1, 2]);
    });

    it("excludes каждого запроса едут свои — настройка живая", () => {
        const { spawnProcess, spawned } = processFactory();
        const watcher = new SubprocessTreeWatcher({ spawnProcess });

        watcher.watchTree("/repo", { recursive: true, excludes: ["**/out"] }, () => undefined);
        watcher.watchTree("/repo", { recursive: true, excludes: ["**/out", "**/dist"] }, () => undefined);

        expect(spawned[0]?.sent.map((m) => (m.t === "watch" ? m.options.excludes : null))).toEqual([
            ["**/out"],
            ["**/out", "**/dist"],
        ]);
    });

    it("пачка событий доезжает до колбэка своего запроса", () => {
        const { spawnProcess, spawned } = processFactory();
        const watcher = new SubprocessTreeWatcher({ spawnProcess });
        const first: ITreeFileChange[][] = [];
        const second: ITreeFileChange[][] = [];
        watcher.watchTree("/repo", OPTIONS, (changes) => first.push([...changes]));
        watcher.watchTree("/other", OPTIONS, (changes) => second.push([...changes]));

        spawned[0]?.emit({ t: "changes", id: 2, changes: CHANGES });

        expect(first).toEqual([]);
        expect(second).toEqual([CHANGES]);
    });

    it("dispose запроса шлёт unwatch и глушит его поток", () => {
        const { spawnProcess, spawned } = processFactory();
        const watcher = new SubprocessTreeWatcher({ spawnProcess });
        const seen: ITreeFileChange[][] = [];
        const subscription = watcher.watchTree("/repo", OPTIONS, (changes) => seen.push([...changes]));

        subscription.dispose();
        // Пачка, обогнавшая unwatch в канале: доставлять её уже некому.
        spawned[0]?.emit({ t: "changes", id: 1, changes: CHANGES });

        expect(spawned[0]?.sent.at(-1)).toEqual({ t: "unwatch", id: 1 });
        expect(seen).toEqual([]);
    });

    it("повторный dispose не шлёт второй unwatch", () => {
        const { spawnProcess, spawned } = processFactory();
        const watcher = new SubprocessTreeWatcher({ spawnProcess });
        const subscription = watcher.watchTree("/repo", OPTIONS, () => undefined);

        subscription.dispose();
        subscription.dispose();

        expect(spawned[0]?.sent.filter((m) => m.t === "unwatch")).toHaveLength(1);
    });

    it("процесс живёт и без единого подписчика — следующий запрос не платит за спавн", () => {
        const { spawnProcess, spawned } = processFactory();
        const watcher = new SubprocessTreeWatcher({ spawnProcess });
        watcher.watchTree("/repo", OPTIONS, () => undefined).dispose();

        watcher.watchTree("/repo", OPTIONS, () => undefined);

        expect(spawned).toHaveLength(1);
    });

    it("мусор из процесса игнорируется", () => {
        const { spawnProcess, spawned } = processFactory();
        const watcher = new SubprocessTreeWatcher({ spawnProcess });
        const seen: ITreeFileChange[][] = [];
        watcher.watchTree("/repo", OPTIONS, (changes) => seen.push([...changes]));

        expect(() => {
            spawned[0]?.emit({ nonsense: true });
        }).not.toThrow();
        expect(seen).toEqual([]);
    });

    it("пачка для уже неизвестного id не роняет хост", () => {
        const { spawnProcess, spawned } = processFactory();
        const watcher = new SubprocessTreeWatcher({ spawnProcess });
        watcher.watchTree("/repo", OPTIONS, () => undefined);

        expect(() => {
            spawned[0]?.emit({ t: "changes", id: 99, changes: CHANGES });
        }).not.toThrow();
    });

    describe("диагностика watcher-процесса", () => {
        it("запись лога из процесса уезжает в канал хоста вместе с аргументами", () => {
            const { logService, entries } = createLogService();
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({
                spawnProcess,
                logger: logService.createLogger("files.watcher"),
            });
            watcher.watchTree("/repo", OPTIONS, () => undefined);

            spawned[0]?.emit({
                t: "log",
                level: "warn",
                message: "tree watcher error — inotify watch limit reached",
                args: [{ code: "ENOSPC" }],
            });

            const entry = entries.at(-1);
            expect(entry?.channel).toBe("files.watcher");
            expect(entry?.level).toBe(LogLevel.Warn);
            expect(entry?.message).toContain("inotify watch limit reached");
            expect(entry?.args).toEqual([{ code: "ENOSPC" }]);
        });

        it("уровень записи сохраняется (error не приезжает как info)", () => {
            const { logService, entries } = createLogService();
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({
                spawnProcess,
                logger: logService.createLogger("files.watcher"),
            });
            watcher.watchTree("/repo", OPTIONS, () => undefined);

            spawned[0]?.emit({ t: "log", level: "error", message: "boom", args: [] });

            expect(entries.at(-1)?.level).toBe(LogLevel.Error);
        });

        it("без логгера запись из процесса просто теряется", () => {
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({ spawnProcess });
            watcher.watchTree("/repo", OPTIONS, () => undefined);

            expect(() => {
                spawned[0]?.emit({ t: "log", level: "warn", message: "x", args: [] });
            }).not.toThrow();
        });
    });

    describe("смерть процесса", () => {
        it("живые запросы переподписываются на новый процесс", () => {
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({ spawnProcess });
            watcher.watchTree("/repo", { recursive: true, excludes: ["**/out"] }, () => undefined);
            watcher.watchTree("/other", { recursive: false, excludes: [] }, () => undefined);

            spawned[0]?.die();

            expect(spawned).toHaveLength(2);
            expect(spawned[1]?.sent).toEqual([
                { t: "watch", id: 1, rootPath: "/repo", options: { recursive: true, excludes: ["**/out"] } },
                { t: "watch", id: 2, rootPath: "/other", options: { recursive: false, excludes: [] } },
            ]);
        });

        it("поток переподписанного запроса идёт в тот же колбэк", () => {
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({ spawnProcess });
            const seen: ITreeFileChange[][] = [];
            watcher.watchTree("/repo", OPTIONS, (changes) => seen.push([...changes]));

            spawned[0]?.die();
            spawned[1]?.emit({ t: "changes", id: 1, changes: CHANGES });

            expect(seen).toEqual([CHANGES]);
        });

        it("снятый запрос после перезапуска не воскресает", () => {
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({ spawnProcess });
            watcher.watchTree("/repo", OPTIONS, () => undefined).dispose();

            spawned[0]?.die();

            // Переподписывать нечего — и поднимать процесс ради этого незачем.
            expect(spawned).toHaveLength(1);
        });

        it("серия смертей заканчивается отказом от слежения, а не бесконечным спавном", () => {
            const { logService, entries } = createLogService();
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({
                spawnProcess,
                logger: logService.createLogger("files.watcher"),
                maxRestarts: 2,
            });
            watcher.watchTree("/repo", OPTIONS, () => undefined);

            spawned[0]?.die();
            spawned[1]?.die();
            spawned[2]?.die();

            expect(spawned).toHaveLength(3);
            const entry = entries.at(-1);
            expect(entry?.level).toBe(LogLevel.Error);
            expect(entry?.message).toContain("file watching is disabled");
            expect(entry?.args).toEqual([{ restarts: 2, requests: 1 }]);
        });

        it("после отказа новые запросы процесс уже не поднимают", () => {
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({ spawnProcess, maxRestarts: 0 });
            watcher.watchTree("/repo", OPTIONS, () => undefined);
            spawned[0]?.die();

            watcher.watchTree("/other", OPTIONS, () => undefined);

            expect(spawned).toHaveLength(1);
        });

        it("отписка без живого процесса не падает", () => {
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({ spawnProcess, maxRestarts: 0 });
            watcher.watchTree("/repo", OPTIONS, () => undefined);
            spawned[0]?.die();
            // Процесса больше нет, а запрос жив — его владелец всё равно однажды
            // отпустит подписку (расширение деактивировалось, редактор закрылся).
            const orphan = watcher.watchTree("/other", OPTIONS, () => undefined);

            expect(() => {
                orphan.dispose();
            }).not.toThrow();
        });

        it("перезапуск пишет предупреждение — потерянные за это время события видны в логе", () => {
            const { logService, entries } = createLogService();
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({
                spawnProcess,
                logger: logService.createLogger("files.watcher"),
            });
            watcher.watchTree("/repo", OPTIONS, () => undefined);

            spawned[0]?.die();

            const entry = entries.find((e) => e.level === LogLevel.Warn && e.message.includes("restarting"));
            expect(entry).toBeDefined();
            expect(entry?.args).toEqual([{ restart: 1, requests: 1 }]);
        });

        it("не поднявшийся процесс (error без exit) всё равно ведёт к перезапуску", () => {
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({ spawnProcess });
            watcher.watchTree("/repo", OPTIONS, () => undefined);

            // У неудачного спавна `exit` может не прийти вовсе — если ждать
            // только его, прокси навсегда остался бы с мёртвой ссылкой.
            spawned[0]?.fail(Object.assign(new Error("spawn EMFILE"), { code: "EMFILE" }));

            expect(spawned).toHaveLength(2);
            expect(spawned[1]?.sent).toEqual([{ t: "watch", id: 1, rootPath: "/repo", options: OPTIONS }]);
        });

        it("отказ процесса виден в логе с кодом ошибки", () => {
            const { logService, entries } = createLogService();
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({
                spawnProcess,
                logger: logService.createLogger("files.watcher"),
            });
            watcher.watchTree("/repo", OPTIONS, () => undefined);

            spawned[0]?.fail(Object.assign(new Error("spawn EMFILE"), { code: "EMFILE" }));

            const entry = entries.find((e) => e.message.includes("file watcher process error"));
            expect(entry?.channel).toBe("files.watcher");
            expect(entry?.args).toEqual([{ code: "EMFILE", error: "Error: spawn EMFILE" }]);
        });

        it("exit следом за обработанным error не поднимает второй процесс", () => {
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({ spawnProcess });
            watcher.watchTree("/repo", OPTIONS, () => undefined);

            spawned[0]?.fail(new Error("spawn ENOENT"));
            // Node не обещает `exit` после `error`, но и не запрещает его.
            spawned[0]?.die();

            expect(spawned).toHaveLength(2);
        });

        it("ошибка канала уже снятого процесса не трогает новый и не сорит в лог", () => {
            const { logService, entries } = createLogService();
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({
                spawnProcess,
                logger: logService.createLogger("files.watcher"),
            });
            watcher.watchTree("/repo", OPTIONS, () => undefined);
            spawned[0]?.die();

            // Типовой случай: ERR_IPC_CHANNEL_CLOSED от `send` в мёртвый канал
            // прилетает уже после того, как на замену поднят новый процесс. Про
            // отказ этого процесса уже всё сказано — второй раз не жалуемся.
            spawned[0]?.fail(new Error("ERR_IPC_CHANNEL_CLOSED"));

            expect(spawned).toHaveLength(2);
            expect(entries.filter((e) => e.message.includes("file watcher process error"))).toEqual([]);
        });

        it("ошибка без errno-кода логируется без падения", () => {
            const { logService, entries } = createLogService();
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({
                spawnProcess,
                logger: logService.createLogger("files.watcher"),
            });
            watcher.watchTree("/repo", OPTIONS, () => undefined);

            // Контракт шва — `unknown`: разбор ошибки не имеет права упасть сам,
            // иначе мы вернём ровно то падение редактора, от которого уходим.
            expect(() => {
                spawned[0]?.fail(undefined);
            }).not.toThrow();

            const entry = entries.find((e) => e.message.includes("file watcher process error"));
            expect(entry?.args).toEqual([{ code: undefined, error: "undefined" }]);
        });

        it("серия смертей считается ПОДРЯД: прожитый рабочий срок обнуляет счёт", () => {
            const { spawnProcess, spawned } = processFactory();
            let clock = 0;
            const watcher = new SubprocessTreeWatcher({ spawnProcess, maxRestarts: 1, now: () => clock });
            watcher.watchTree("/repo", OPTIONS, () => undefined);

            spawned[0]?.die(); // первая смерть — перезапуск (бюджет исчерпан)
            clock += 60_000; // второй процесс прожил рабочий срок
            spawned[1]?.die(); // значит это снова «первая» смерть, а не вторая
            clock += 60_000;
            spawned[2]?.die();

            expect(spawned).toHaveLength(4);
        });

        it("смерти в пределах рабочего срока счёт не обнуляют", () => {
            const { spawnProcess, spawned } = processFactory();
            let clock = 0;
            const watcher = new SubprocessTreeWatcher({ spawnProcess, maxRestarts: 1, now: () => clock });
            watcher.watchTree("/repo", OPTIONS, () => undefined);

            spawned[0]?.die();
            clock += 59_999;
            spawned[1]?.die();

            expect(spawned).toHaveLength(2);
        });

        it("опоздавший exit старого процесса не трогает новый", () => {
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({ spawnProcess });
            watcher.watchTree("/repo", OPTIONS, () => undefined);
            spawned[0]?.die();

            spawned[0]?.die();

            expect(spawned).toHaveLength(2);
        });
    });

    describe("dispose", () => {
        it("снимает процесс синхронно", () => {
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({ spawnProcess });
            watcher.watchTree("/repo", OPTIONS, () => undefined);

            watcher.dispose();

            expect(spawned[0]?.kills).toBe(1);
        });

        it("убитый процесс не переподнимается — окно уходит, а не чинится", () => {
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({ spawnProcess });
            watcher.watchTree("/repo", OPTIONS, () => undefined);

            watcher.dispose();

            expect(spawned).toHaveLength(1);
        });

        it("пачка, пришедшая после dispose, до подписчика не доезжает", () => {
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({ spawnProcess });
            const seen: ITreeFileChange[][] = [];
            watcher.watchTree("/repo", OPTIONS, (changes) => seen.push([...changes]));

            watcher.dispose();
            // Убитый ребёнок мог успеть положить пачку в канал — владелец окна
            // уже попрощался, доставлять её некуда.
            spawned[0]?.emit({ t: "changes", id: 1, changes: CHANGES });

            expect(seen).toEqual([]);
        });

        it("без поднятого процесса dispose — no-op", () => {
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({ spawnProcess });

            expect(() => {
                watcher.dispose();
            }).not.toThrow();
            expect(spawned).toHaveLength(0);
        });

        it("повторный dispose не убивает второй раз", () => {
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({ spawnProcess });
            watcher.watchTree("/repo", OPTIONS, () => undefined);

            watcher.dispose();
            watcher.dispose();

            expect(spawned[0]?.kills).toBe(1);
        });

        it("запрос после dispose процесс не поднимает", () => {
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({ spawnProcess });
            watcher.dispose();

            watcher.watchTree("/repo", OPTIONS, () => undefined);

            expect(spawned).toHaveLength(0);
        });
    });
});
