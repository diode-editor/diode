import type { IDisposable } from "../../../base/common/lifecycle.ts";
import { GuardedChildProcess } from "../../../base/node/childProcessGuard.ts";
import { spawnSelfAsRole } from "../../../base/node/selfSpawnArgs.ts";
import { token } from "../../instantiation/common/diContainer.ts";
import type { ILogger } from "../../log/common/iLogger.ts";
import type { ITreeFileChange, ITreeFileWatcher, ITreeFileWatchOptions } from "../common/iTreeFileWatcher.ts";

import type { ITreeWatcherRequest } from "./treeWatcherProtocol.ts";
import { parseTreeWatcherResponse } from "./treeWatcherProtocol.ts";

/**
 * Смертей **подряд** до отказа от слежения: падать процессу нечем (chokidar
 * ловит свои ошибки сам), серия — это сломанное окружение, и бесконечные
 * спавны хуже честного «живём без слежения».
 */
const DEFAULT_MAX_RESTARTS = 3;

/** Прожив столько, процесс обнуляет счётчик смертей — иначе «подряд» стало бы «за сессию». */
const HEALTHY_UPTIME_MS = 60_000;

export interface IWatcherProcess {
    send(message: ITreeWatcherRequest): void;
    onMessage(listener: (message: unknown) => void): void;
    onExit(listener: () => void): void;
    /**
     * Отдельно от {@link onExit}: у неудачного спавна `exit` может не прийти
     * вовсе, а `error` без слушателя у EventEmitter'а — исключение, смерть редактора.
     */
    onError(listener: (error: unknown) => void): void;
    /** Синхронно. */
    kill(): void;
}

export interface ISubprocessTreeWatcherOptions {
    readonly logger?: ILogger;
    readonly spawnProcess?: () => IWatcherProcess;
    readonly maxRestarts?: number;
    readonly now?: () => number;
}

interface IWatchRequest {
    readonly rootPath: string;
    readonly options: ITreeFileWatchOptions;
    readonly onChanges: (changes: readonly ITreeFileChange[]) => void;
}

/**
 * Обход дерева — в **отдельном процессе** (как `--type=fileWatcher` у VS Code):
 * рекурсивный `readdir`+`stat`+inotify — секунды работы, в главном цикле они
 * роняли отклик на сотни мс при открытии файла в большом репозитории.
 *
 * Не `worker_threads`: его `stat` идут в тот же libuv-threadpool (4 потока),
 * что и чтение открываемых файлов, — обход заткнул бы открытие файла. У процесса
 * свои threadpool и куча.
 *
 * Процесс поднимается лениво, по первому `watchTree`: спавн на старте лишь
 * перенёс бы задержку. Дедупликация (`SharedTreeWatcher`) — внутри процесса.
 * Смерть ребёнка и несостоявшийся спавн сходятся в одну ветку: перезапуск с
 * переподпиской, после серии — «живём без слежения»; уронить редактор не вправе.
 */
export class SubprocessTreeWatcher implements ITreeFileWatcher {
    private readonly logger: ILogger | undefined;
    private readonly spawnProcess: () => IWatcherProcess;
    private readonly maxRestarts: number;
    private readonly now: () => number;
    private readonly requests = new Map<number, IWatchRequest>();
    private child: IWatcherProcess | null = null;
    private childStartedAt = 0;
    private nextId = 1;
    private restarts = 0;
    private gaveUp = false;
    private disposed = false;

    public constructor(options: ISubprocessTreeWatcherOptions = {}) {
        this.logger = options.logger;
        this.spawnProcess = options.spawnProcess ?? (() => spawnWatcherProcess(this.logger));
        this.maxRestarts = options.maxRestarts ?? DEFAULT_MAX_RESTARTS;
        this.now = options.now ?? Date.now;
    }

    public watchTree(
        rootPath: string,
        options: ITreeFileWatchOptions,
        onChanges: (changes: readonly ITreeFileChange[]) => void,
    ): IDisposable {
        const id = this.nextId++;
        this.requests.set(id, { rootPath, options, onChanges });
        // Только что заспавненному процессу слать можно: node буферизует IPC до
        // первого читателя и отдаёт в порядке отправки.
        this.ensureProcess()?.send({ t: "watch", id, rootPath, options });
        return {
            dispose: () => {
                if (!this.requests.delete(id)) return;
                this.child?.send({ t: "unwatch", id });
                // Процесс не гасим на последнем отписавшемся: в простое он ничего
                // не стоит, а следующий запрос иначе платил бы за новый спавн.
            },
        };
    }

    /**
     * Синхронно — для reload окна: супервизор затем блокируется в `spawnSync`,
     * и не убитый watcher пережил бы окно, держа inotify-подписки рядом с новыми.
     */
    public dispose(): void {
        this.disposed = true;
        // Иначе пачка, уже лежащая в канале, доехала бы до подписчика после прощания.
        this.requests.clear();
        this.child?.kill();
        this.child = null;
    }

    /** `null` — слежения больше нет. */
    private ensureProcess(): IWatcherProcess | null {
        if (this.child !== null) return this.child;
        if (this.disposed || this.gaveUp) return null;
        return this.startProcess();
    }

    private startProcess(): IWatcherProcess {
        this.logger?.debug("spawning file watcher process");
        const child = this.spawnProcess();
        child.onMessage((message) => {
            this.handleMessage(message);
        });
        child.onExit(() => {
            this.handleExit(child);
        });
        child.onError((error) => {
            this.handleChildError(child, error);
        });
        this.child = child;
        this.childStartedAt = this.now();
        return child;
    }

    private handleMessage(raw: unknown): void {
        const message = parseTreeWatcherResponse(raw);
        if (message === null) return;
        if (message.t === "log") {
            this.logger?.[message.level](message.message, ...message.args);
            return;
        }
        // Пачка могла обогнать уже отправленный `unwatch` — доставлять некому.
        this.requests.get(message.id)?.onChanges(message.changes);
    }

    /**
     * Два реальных пути: `send()` в канал мёртвого процесса (`ERR_IPC_CHANNEL_CLOSED`
     * приходит событием позже, `try/catch` вокруг `send` не спасает) и неудачный
     * спавн (`EMFILE`/`EAGAIN`, `ENOENT`), после которого `exit` может не прийти
     * вовсе — без этой ветки прокси навсегда остался бы с мёртвой ссылкой.
     */
    private handleChildError(child: IWatcherProcess, error: unknown): void {
        if (this.child !== child) return;
        this.logger?.warn("file watcher process error", {
            code: (error as NodeJS.ErrnoException | undefined)?.code,
            error: String(error),
        });
        this.handleExit(child);
    }

    /** События за время перезапуска теряются — об этом пишем в лог. */
    private handleExit(child: IWatcherProcess): void {
        // Опоздавший exit снятого процесса (в т. ч. следом за обработанным `error`) не трогает новый.
        if (this.child !== child) return;
        this.child = null;
        if (this.disposed || this.requests.size === 0) return;
        if (this.now() - this.childStartedAt >= HEALTHY_UPTIME_MS) this.restarts = 0;
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
        const restarted = this.startProcess();
        for (const [id, request] of this.requests) {
            restarted.send({ t: "watch", id, rootPath: request.rootPath, options: request.options });
        }
    }
}

/** `main.ts` гасит его при reload окна. */
// Stryker disable next-line StringLiteral: id токена — только имя в диагностике контейнера
// («No binding for …», цикл зависимостей); на разрешение биндинга влияет идентичность объекта.
export const SubprocessTreeWatcherDIToken = token<SubprocessTreeWatcher>("SubprocessTreeWatcher");

/** stdout ребёнку закрыт: он делит терминал с редактором, случайная печать испортила бы кадр. */
function spawnWatcherProcess(logger: ILogger | undefined): IWatcherProcess {
    const child = spawnSelfAsRole("DIODE_FILE_WATCHER", { stderr: "pipe" });
    const guard = new GuardedChildProcess(child, { label: "file-watcher", logger, logStderr: true });
    return {
        send: (message) => {
            // Ловит только синхронный throw; асинхронный ERR_IPC_CHANNEL_CLOSED приходит в onError.
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
            guard.onDidEnd((end) => {
                // Stryker disable next-line ConditionalExpression: на конце с ошибкой onError уже провёл смерть (handleChildError → handleExit), и второй handleExit — no-op по сверке процесса
                if (end.error === undefined) listener();
            });
        },
        onError: (listener) => {
            guard.onDidEnd((end) => {
                // Stryker disable next-line ConditionalExpression: на чистом выходе onExit (подписан раньше) уже снял процесс, и handleChildError выходит на сверке процесса
                if (end.error !== undefined) listener(end.error);
            });
        },
        kill: () => {
            guard.dispose();
        },
    };
}
