import { spawn } from "node:child_process";

import type { IDisposable } from "@tuidom/core/common/disposable";

import { selfSpawnArgs } from "../../../base/node/selfSpawnArgs.ts";
import { token } from "../../instantiation/common/diContainer.ts";
import type { ILogger } from "../../log/common/iLogger.ts";
import type { ITreeFileChange, ITreeFileWatcher, ITreeFileWatchOptions } from "../common/iTreeFileWatcher.ts";

import type { ITreeWatcherRequest } from "./treeWatcherProtocol.ts";
import { parseTreeWatcherResponse } from "./treeWatcherProtocol.ts";

/**
 * Сколько смертей **подряд** переживаем, поднимая процесс заново, прежде чем
 * признать слежение нерабочим. Падать ему нечем (chokidar свои ошибки ловит
 * сам), так что серия подряд — это не невезение, а сломанное окружение;
 * бесконечный цикл спавнов в такой ситуации хуже, чем честное «живём без
 * слежения» записью в лог.
 */
const DEFAULT_MAX_RESTARTS = 3;

/**
 * Сколько процесс должен прожить, чтобы счётся смертей обнулился. Без этого
 * «три смерти подряд» превращались бы в «три смерти за сессию»: редактор живёт
 * часами, и три несвязанные смерти за это время — не признак сломанного
 * окружения.
 */
const HEALTHY_UPTIME_MS = 60_000;

/** Живой watcher-процесс глазами хоста. Шов для тестов — см. `spawnProcess`. */
export interface IWatcherProcess {
    send(message: ITreeWatcherRequest): void;
    onMessage(listener: (message: unknown) => void): void;
    onExit(listener: () => void): void;
    /**
     * Процесс не поднялся или его канал сломался. Отдельно от {@link onExit}:
     * у неудачного спавна `exit` может не быть вовсе, а подписаться **обязаны**
     * — необработанное `error` у EventEmitter'а это не запись в лог, а
     * исключение, то есть смерть редактора.
     */
    onError(listener: (error: unknown) => void): void;
    /** Снять процесс немедленно и синхронно. */
    kill(): void;
}

export interface ISubprocessTreeWatcherOptions {
    readonly logger?: ILogger;
    /** Как поднять watcher-процесс. По умолчанию — форк самого себя. */
    readonly spawnProcess?: () => IWatcherProcess;
    readonly maxRestarts?: number;
    /** Часы для счёта «прожил достаточно». Шов для тестов. */
    readonly now?: () => number;
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
 *
 * Отказ границы процесса — не исключение, а штатный вход: и смерть ребёнка, и
 * его несостоявшийся спавн сходятся в одну ветку (перезапуск с переподпиской,
 * после серии подряд — «живём без слежения»). Ни один из этих путей не имеет
 * права уронить редактор — см. {@link handleChildError}.
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
    /** Процесс умер столько раз, что дальше поднимать его бессмысленно. */
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
        this.disposed = true;
        // Запросы снимаем, а не оставляем: убитый ребёнок мог успеть положить в
        // канал пачку, и без этого она доехала бы до подписчика уже после того,
        // как владелец окна попрощался.
        this.requests.clear();
        this.child?.kill();
        this.child = null;
    }

    /** Живой процесс; поднимает его при первой надобности. `null` — слежения больше нет. */
    private ensureProcess(): IWatcherProcess | null {
        if (this.child !== null) return this.child;
        if (this.disposed || this.gaveUp) return null;
        return this.startProcess();
    }

    /** Безусловно поднимает новый процесс и подписывается на него. */
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
        // Запрос мог отписаться, пока пачка летела через IPC: `unwatch` уже
        // отправлен, но эти события её обогнали — доставлять их некому.
        this.requests.get(message.id)?.onChanges(message.changes);
    }

    /**
     * Процесс не поднялся, или его канал сломался. Подписка на это —
     * обязательна, а не «на всякий случай»: `error` без слушателя у
     * EventEmitter'а всплывает как исключение и убивает **редактор**.
     * Достижимых путей два, и оба реальны:
     *
     * - `send()` в канал уже мёртвого процесса. Синхронно он лишь возвращает
     *   `false`, а `ERR_IPC_CHANNEL_CLOSED` приходит событием позже — то есть
     *   `try/catch` вокруг `send` от него не спасает. Окно — между настоящей
     *   смертью ребёнка и доставкой его `exit`;
     * - неудачный спавн (`EMFILE`/`EAGAIN` под нагрузкой — ровно то окружение,
     *   ради которого всё это и делается; `ENOENT` — битая установка). Здесь
     *   `exit` может не прийти **вовсе**, поэтому рассчитывать только на него
     *   нельзя: прокси навсегда остался бы с мёртвой ссылкой, и все
     *   последующие запросы молча уходили бы в никуда.
     *
     * Дальше — общая с смертью процесса ветка: перезапуск или отказ.
     */
    private handleChildError(child: IWatcherProcess, error: unknown): void {
        if (this.child !== child) return;
        this.logger?.warn("file watcher process error", {
            code: (error as NodeJS.ErrnoException | undefined)?.code,
            error: String(error),
        });
        this.handleExit(child);
    }

    /**
     * Watcher-процесс умер сам. Живые запросы переподписываем на новый —
     * молча остаться без слежения хуже, чем потерять события за время
     * перезапуска (их мы всё равно потеряли, о чём и пишем в лог).
     */
    private handleExit(child: IWatcherProcess): void {
        // Опоздавший exit уже снятого процесса не должен трогать новый (в том
        // числе exit следом за обработанным `error` — он приходит не всегда).
        if (this.child !== child) return;
        this.child = null;
        if (this.disposed || this.requests.size === 0) return;
        // Счётчик про смерти ПОДРЯД: процесс, проживший рабочий срок, обнуляет
        // его, иначе три несвязанные смерти за долгую сессию выглядели бы как
        // сломанное окружение.
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
        // Именно startProcess: «поднять, если надо» здесь не подходит — живого
        // процесса заведомо нет, а отказ от подъёма разобран выше.
        const restarted = this.startProcess();
        for (const [id, request] of this.requests) {
            restarted.send({ t: "watch", id, rootPath: request.rootPath, options: request.options });
        }
    }
}

/** Токен концентрирует владение процессом: `main.ts` гасит его при reload окна. */
// Stryker disable next-line StringLiteral: id токена — только имя в диагностике контейнера
// («No binding for …», цикл зависимостей); на разрешение биндинга влияет идентичность объекта.
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
    // `stderr` — поток только при нашем `"pipe"`; тип допускает и `null`
    // (`"ignore"` у других вызывающих), поэтому проверка, а не `?.` на каждой строке.
    const { stderr } = child;
    if (stderr !== null) {
        // Без явной кодировки в обработчик приезжает Buffer, и строковые операции
        // над ним молча дают не то.
        stderr.setEncoding("utf8");
        stderr.on("data", (chunk: string) => {
            // Ребёнок пишет строками с `\n`; лог-канал сам разделяет записи.
            logger?.warn(`[file-watcher] ${chunk.trimEnd()}`);
        });
        // Слушатель обязателен по той же причине, что и на самом процессе:
        // сломавшийся поток без него убил бы редактор. Состояние процесса от
        // этого не меняется — его ведут `exit`/`error` на нём самом.
        stderr.on("error", (error: unknown) => {
            logger?.warn(`[file-watcher] stderr stream error: ${String(error)}`);
        });
    }
    return {
        send: (message) => {
            // Синхронный throw (канал уже закрыт к моменту вызова) — молча;
            // асинхронный ERR_IPC_CHANNEL_CLOSED приходит событием `error`,
            // и его ловит подписка ниже, а не этот catch.
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
        onError: (listener) => {
            // `on`, а не `once`: закрытый канал эмитит ошибку на каждый `send`,
            // и второй такой без слушателя снова уронил бы редактор.
            child.on("error", listener);
        },
        kill: () => {
            // Мёртвому ребёнку `kill` не бросает — отдельной проверки не нужно.
            child.kill("SIGKILL");
        },
    };
}
