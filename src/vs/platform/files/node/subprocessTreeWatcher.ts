import { spawn } from "node:child_process";

import type { IDisposable } from "@tuidom/core/common/disposable";

import { selfSpawnArgs } from "../../../base/node/selfSpawnArgs.ts";
import { token } from "../../instantiation/common/diContainer.ts";
import type { ILogger } from "../../log/common/iLogger.ts";
import type { ITreeFileChange, ITreeFileWatcher, ITreeFileWatchOptions } from "../common/iTreeFileWatcher.ts";

import type { ITreeWatcherRequest } from "./treeWatcherProtocol.ts";
import { parseTreeWatcherResponse } from "./treeWatcherProtocol.ts";

/**
 * Сколько раз поднимаем watcher-процесс заново после неожиданной смерти,
 * прежде чем признать слежение нерабочим. Падать ему нечем (chokidar свои
 * ошибки ловит сам), так что серия смертей подряд — это не невезение, а
 * сломанное окружение; бесконечный цикл спавнов в такой ситуации хуже, чем
 * честное «живём без слежения» записью в лог.
 */
const DEFAULT_MAX_RESTARTS = 3;

/** Живой watcher-процесс глазами хоста. Шов для тестов — см. `spawnProcess`. */
export interface IWatcherProcess {
    send(message: ITreeWatcherRequest): void;
    onMessage(listener: (message: unknown) => void): void;
    onExit(listener: () => void): void;
    /** Снять процесс немедленно и синхронно. */
    kill(): void;
}

export interface ISubprocessTreeWatcherOptions {
    readonly logger?: ILogger;
    /** Как поднять watcher-процесс. По умолчанию — форк самого себя. */
    readonly spawnProcess?: () => IWatcherProcess;
    readonly maxRestarts?: number;
}

interface IWatchRequest {
    readonly rootPath: string;
    readonly options: ITreeFileWatchOptions;
    readonly onChanges: (changes: readonly ITreeFileChange[]) => void;
}

/**
 * {@link ITreeFileWatcher}, у которого весь обход дерева живёт в **отдельном
 * процессе**, а здесь остаётся только маршрутизация готовых пачек событий.
 *
 * Зачем процесс, а не просто оптимизация обхода. Полный рекурсивный `readdir`
 * с `stat` на каждый вход и inotify-подпиской на каждый каталог — это секунды
 * работы, и вся она шла в главном цикле редактора: на открытии файла в большом
 * репозитории отклик проседал на сотни миллисекунд подряд, пока обход не
 * закончится. Уменьшить эту работу можно (excludes, общий обход на
 * пересекающиеся запросы), убрать — нет: дерево такое, какое оно есть.
 * Единственный способ перестать платить за неё отзывчивостью — унести её из
 * процесса, который рисует. Суммарный CPU при этом не падает, он переезжает.
 *
 * Почему процесс, а не `worker_threads`. Воркер дешевле стартует, но его
 * файловые операции идут в **тот же** libuv-threadpool (по умолчанию 4 потока),
 * что и чтение открываемых файлов главным потоком: обход, ставящий в очередь
 * десятки тысяч `stat`, способен заткнуть ею открытие файла — то есть вернуть
 * ту же проседающую отзывчивость с другой стороны. У отдельного процесса свой
 * threadpool и своя куча (аллокации обхода не дают GC-паузы главному), и это
 * же решение принято в VS Code (`--type=fileWatcher`).
 *
 * Процесс поднимается **лениво, по первому `watchTree`**, а не на старте:
 * спавн на критическом пути запуска — это ровно та задержка, которую мы
 * переносим, а не убираем. Запросов на слежение в сессии без расширений может
 * не быть вовсе.
 *
 * Дедупликация (`SharedTreeWatcher`) живёт **за** этой границей, в самом
 * watcher-процессе — как в VS Code: чем меньше обходов, тем лучше, но решать
 * это должен тот, кто их ведёт.
 */
export class SubprocessTreeWatcher implements ITreeFileWatcher {
    private readonly logger: ILogger | undefined;
    private readonly spawnProcess: () => IWatcherProcess;
    private readonly maxRestarts: number;
    private readonly requests = new Map<number, IWatchRequest>();
    private child: IWatcherProcess | null = null;
    private nextId = 1;
    private restarts = 0;
    /** Процесс умер столько раз, что дальше поднимать его бессмысленно. */
    private gaveUp = false;
    private disposed = false;

    public constructor(options: ISubprocessTreeWatcherOptions = {}) {
        this.logger = options.logger;
        this.spawnProcess = options.spawnProcess ?? (() => spawnWatcherProcess(this.logger));
        this.maxRestarts = options.maxRestarts ?? DEFAULT_MAX_RESTARTS;
    }

    public watchTree(
        rootPath: string,
        options: ITreeFileWatchOptions,
        onChanges: (changes: readonly ITreeFileChange[]) => void,
    ): IDisposable {
        const id = this.nextId++;
        this.requests.set(id, { rootPath, options, onChanges });
        // Отправляем, даже если процесс только что заспавнен и ещё не дошёл до
        // своей точки входа: node буферизует IPC-сообщения до первого читателя
        // на той стороне и отдаёт их в порядке отправки.
        this.ensureProcess()?.send({ t: "watch", id, rootPath, options });
        return {
            dispose: () => {
                // Повторный dispose — no-op: снимать чужой (переиспользованный)
                // id нельзя, а id мы не переиспользуем.
                if (!this.requests.delete(id)) return;
                this.child?.send({ t: "unwatch", id });
                // Процесс не гасим на последнем отписавшемся: в простое он ничего
                // не стоит, а следующий запрос иначе платил бы за новый спавн.
            },
        };
    }

    /**
     * Снимает watcher-процесс синхронно. Звать там, где дальше event loop не
     * крутится, — при перезагрузке окна: супервизор после `restartProcess`
     * блокируется в `spawnSync`, IPC-канал остаётся открытым, и не убитый
     * watcher пережил бы своё окно, продолжая держать inotify-подписки рядом с
     * подписками нового.
     */
    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.requests.clear();
        this.child?.kill();
        this.child = null;
    }

    /** Живой процесс; поднимает его при первой надобности. `null` — слежения больше нет. */
    private ensureProcess(): IWatcherProcess | null {
        if (this.child !== null) return this.child;
        if (this.disposed || this.gaveUp) return null;
        this.logger?.debug("spawning file watcher process");
        const child = this.spawnProcess();
        child.onMessage((message) => {
            this.handleMessage(message);
        });
        child.onExit(() => {
            this.handleExit(child);
        });
        this.child = child;
        return child;
    }

    private handleMessage(raw: unknown): void {
        const message = parseTreeWatcherResponse(raw);
        if (message === null) return;
        if (message.t === "log") {
            this.logger?.[message.level](message.message, ...message.args);
            return;
        }
        // Запрос мог отписаться, пока пачка летела через IPC: `unwatch` уже
        // отправлен, но эти события её обогнали — доставлять их некому.
        this.requests.get(message.id)?.onChanges(message.changes);
    }

    /**
     * Watcher-процесс умер сам. Живые запросы переподписываем на новый —
     * молча остаться без слежения хуже, чем потерять события за время
     * перезапуска (их мы всё равно потеряли, о чём и пишем в лог).
     */
    private handleExit(child: IWatcherProcess): void {
        // Опоздавший exit уже снятого процесса не должен трогать новый.
        if (this.child !== child) return;
        this.child = null;
        if (this.disposed || this.requests.size === 0) return;
        if (this.restarts >= this.maxRestarts) {
            this.gaveUp = true;
            this.logger?.error("file watcher process keeps dying; file watching is disabled for this session", {
                restarts: this.restarts,
                requests: this.requests.size,
            });
            return;
        }
        this.restarts++;
        this.logger?.warn("file watcher process died; restarting and re-subscribing", {
            restart: this.restarts,
            requests: this.requests.size,
        });
        const restarted = this.ensureProcess();
        for (const [id, request] of this.requests) {
            restarted?.send({ t: "watch", id, rootPath: request.rootPath, options: request.options });
        }
    }
}

/** Токен концентрирует владение процессом: `main.ts` гасит его при reload окна. */
export const SubprocessTreeWatcherDIToken = token<SubprocessTreeWatcher>("SubprocessTreeWatcher");

/**
 * Боевой спавн: тот же бинарь с `DIODE_FILE_WATCHER=1` — ровно та дисциплина,
 * что у extension host'а (`selfSpawnArgs`, env-гейт, ветка в `main.ts`).
 *
 * stdout ребёнку закрыт: он делит терминал с редактором, и любая случайная
 * печать испортила бы кадр. stderr пишет в тот же лог-канал — туда попадает то,
 * что мимо протокола (падение с трассой).
 */
function spawnWatcherProcess(logger: ILogger | undefined): IWatcherProcess {
    const spec = selfSpawnArgs();
    const child = spawn(spec.command, spec.args, {
        stdio: ["ignore", "ignore", "pipe", "ipc"],
        env: { ...process.env, DIODE_FILE_WATCHER: "1" },
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
        logger?.warn(`[file-watcher] ${chunk.trimEnd()}`);
    });
    return {
        send: (message) => {
            // Канал мог закрыться между проверкой и отправкой — молча: смерть
            // процесса обрабатывает `exit`, а не исключение из `send`.
            try {
                child.send(message);
            } catch {
                /* no-op */
            }
        },
        onMessage: (listener) => {
            child.on("message", listener);
        },
        onExit: (listener) => {
            child.once("exit", listener);
        },
        kill: () => {
            // Мёртвому ребёнку `kill` не бросает — отдельной проверки не нужно.
            child.kill("SIGKILL");
        },
    };
}
