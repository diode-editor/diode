import * as fs from "node:fs";
import * as path from "node:path";

import chokidar, { type FSWatcher } from "chokidar";

import { matchAnyGlob } from "../../../base/common/glob.ts";
import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { ILogger } from "../../log/common/iLogger.ts";
import { describeFileWatchError } from "../common/fileWatchErrors.ts";
import type {
    ITreeFileChange,
    ITreeFileWatcher,
    ITreeFileWatchOptions,
    TreeFileChangeType,
} from "../common/iTreeFileWatcher.ts";

/**
 * Окно коалесинга событий, мс. Одна пользовательская операция (checkout,
 * сборка, `npm install`) — это сотни событий подряд; потребителю нужен один
 * батч, а не сотня вызовов.
 */
const COALESCE_MS = 50;

/** Событие chokidar → вид изменения. Каталоги и файлы неразличимы (как в VS Code). */
const EVENT_TYPES: Partial<Record<string, TreeFileChangeType>> = {
    add: "created",
    addDir: "created",
    change: "changed",
    unlink: "deleted",
    unlinkDir: "deleted",
};

/**
 * Реальная реализация {@link ITreeFileWatcher} поверх chokidar (та же
 * зависимость, что у дерева файлов и {@link ChokidarFileWatcher}).
 *
 * Excludes отдаются chokidar как `ignored`-предикат, а не фильтруются после
 * события: предикат зовётся и на каталогах при обходе, поэтому в
 * `node_modules` watcher просто не заходит и не тратит на него inotify.
 *
 * По симлинкам внутри дерева обход не ходит — как parcel-watcher эталона
 * («does not allow to recursively watch symbolic links»): ссылка видна как
 * вход (создание/удаление/перенацеливание), но её цель не обходится. Иначе
 * `bazel-out` и соседи тащат в обход весь кэш Bazel вне воркспейса, а события
 * оттуда приходят расширениям как правки воркспейса. Следить за каталогом-
 * ссылкой — явным запросом на него (`files.watcherInclude`, RelativePattern с
 * такой базой): **корень** запроса разрешается до настоящего пути, а пути
 * событий переписываются обратно на исходный — как `normalizePath` эталона.
 */
export class ChokidarTreeWatcher implements ITreeFileWatcher {
    private readonly logger: ILogger | undefined;

    public constructor(logger?: ILogger) {
        this.logger = logger;
    }

    public watchTree(
        rootPath: string,
        options: ITreeFileWatchOptions,
        onChanges: (changes: readonly ITreeFileChange[]) => void,
    ): IDisposable {
        // Синхронно и один раз на запрос: обход всё равно начнётся позже, а
        // watchTree обязан сразу вернуть disposable. Не разрешился (корня нет) —
        // следим по исходному пути, chokidar сам дождётся появления.
        const watchPath = realpathOrSelf(rootPath);
        const watcher = this.createWatcher(watchPath, options);
        const toOriginal = (changed: string): string => path.join(rootPath, path.relative(watchPath, changed));
        let pending: ITreeFileChange[] = [];
        let timer: ReturnType<typeof setTimeout> | null = null;

        // Таймер взводится только вместе с первым событием пачки, а dispose
        // гасит и его, и накопленное — на flush всегда есть что отдать.
        const flush = (): void => {
            timer = null;
            const batch = pending;
            pending = [];
            onChanges(batch);
        };

        // chokidar 5 с `followSymlinks: false` сообщает `add` на каждый симлинк,
        // найденный НАЧАЛЬНЫМ обходом, мимо `ignoreInitial` (`_handleSymlink`
        // эмитит сам, без флага initialAdd). Это не изменения — до `ready`
        // такие `add` глушим; симлинк, созданный позже, приходит как обычно.
        let ready = false;
        watcher.on("ready", () => {
            ready = true;
        });

        watcher.on("all", (event, changedPath, stats?: fs.Stats) => {
            const type = EVENT_TYPES[event];
            // `ready`/`raw` и прочие служебные события — не изменения файлов.
            if (type === undefined || typeof changedPath !== "string") return;
            if (!ready && event === "add" && stats?.isSymbolicLink() === true) return;
            pending.push({ type, path: toOriginal(changedPath) });
            timer ??= setTimeout(flush, COALESCE_MS);
        });

        // Слушатель 'error' обязателен: без него EventEmitter chokidar'а бросает
        // исключение из своих async-потрохов, оно всплывает как unhandledRejection
        // и убивает процесс (типовой случай — ENOSPC, исчерпан лимит inotify).
        // Живой watcher после такой ошибки всё равно мёртв — закрываем его и живём
        // без слежения за этим деревом, но с работающим редактором.
        watcher.on("error", (error) => {
            const { code, hint } = describeFileWatchError(error);
            this.logger?.warn(`tree watcher error${hint}`, { rootPath, code, error: String(error) });
            void watcher.close();
        });

        return {
            dispose: () => {
                if (timer !== null) {
                    clearTimeout(timer);
                    timer = null;
                }
                pending = [];
                void watcher.close();
            },
        };
    }

    /** Шов для тестов: подменяемое создание реального chokidar-watcher'а. */
    protected createWatcher(rootPath: string, options: ITreeFileWatchOptions): FSWatcher {
        const { excludes } = options;
        return chokidar.watch(rootPath, {
            ignoreInitial: true,
            depth: options.recursive ? undefined : 0,
            // Дефолт chokidar — `true`; эталон по ссылкам не ходит (см. шапку класса).
            followSymlinks: false,
            ignored:
                excludes.length === 0 ? undefined : (candidate: string) => isExcluded(rootPath, candidate, excludes),
        });
    }
}

/** Настоящий путь корня либо сам путь, если разрешить не вышло (нет такого). */
function realpathOrSelf(rootPath: string): string {
    try {
        return fs.realpathSync.native(rootPath);
    } catch {
        return rootPath;
    }
}

/**
 * Матчит кандидата против excludes по пути **относительно корня** в posix-форме —
 * так шаблоны вида `**\/node_modules/**` работают одинаково на всех платформах.
 * Сам корень никогда не исключается: иначе watcher не стартовал бы вовсе.
 */
export function isExcluded(rootPath: string, candidate: string, excludes: readonly string[]): boolean {
    const relative = path.relative(rootPath, candidate);
    if (relative === "") return false;
    return matchAnyGlob(excludes, relative.split(path.sep).join("/"));
}
