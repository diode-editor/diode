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

const COALESCE_MS = 50;

/** Каталоги и файлы неразличимы, как в VS Code. */
const EVENT_TYPES: Partial<Record<string, TreeFileChangeType>> = {
    add: "created",
    addDir: "created",
    change: "changed",
    unlink: "deleted",
    unlinkDir: "deleted",
};

/**
 * Excludes — `ignored`-предикат, а не фильтр после события: он зовётся и на
 * каталогах при обходе, в `node_modules` watcher не заходит и не тратит inotify.
 *
 * По симлинкам внутри дерева обход не ходит, как parcel-watcher эталона: иначе
 * `bazel-out` тащит весь кэш Bazel вне воркспейса. Каталог-ссылку смотрят явным
 * запросом: **корень** разрешается до настоящего пути, пути событий
 * переписываются обратно на исходный (как `normalizePath` эталона).
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
        // Корня нет — следим по исходному пути, chokidar сам дождётся появления.
        const watchPath = realpathOrSelf(rootPath);
        const watcher = this.createWatcher(watchPath, options);
        const toOriginal = (changed: string): string => path.join(rootPath, path.relative(watchPath, changed));
        let pending: ITreeFileChange[] = [];
        let timer: ReturnType<typeof setTimeout> | null = null;

        // Пустой пачки не бывает: таймер взводит первое событие, dispose гасит его вместе с накопленным.
        const flush = (): void => {
            timer = null;
            const batch = pending;
            pending = [];
            onChanges(batch);
        };

        // chokidar 5 с `followSymlinks: false` шлёт `add` на каждый симлинк
        // начального обхода мимо `ignoreInitial` (`_handleSymlink`) — до `ready` глушим.
        let ready = false;
        watcher.on("ready", () => {
            ready = true;
        });

        watcher.on("all", (event, changedPath, stats?: fs.Stats) => {
            const type = EVENT_TYPES[event];
            if (type === undefined || typeof changedPath !== "string") return;
            if (!ready && event === "add" && stats?.isSymbolicLink() === true) return;
            pending.push({ type, path: toOriginal(changedPath) });
            timer ??= setTimeout(flush, COALESCE_MS);
        });

        // Без слушателя 'error' chokidar роняет процесс unhandledRejection'ом
        // (типично ENOSPC — исчерпан лимит inotify); watcher после ошибки мёртв.
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

    protected createWatcher(rootPath: string, options: ITreeFileWatchOptions): FSWatcher {
        const { excludes } = options;
        return chokidar.watch(rootPath, {
            ignoreInitial: true,
            depth: options.recursive ? undefined : 0,
            followSymlinks: false,
            ignored:
                excludes.length === 0 ? undefined : (candidate: string) => isExcluded(rootPath, candidate, excludes),
        });
    }
}

function realpathOrSelf(rootPath: string): string {
    try {
        return fs.realpathSync.native(rootPath);
    } catch {
        return rootPath;
    }
}

/** Путь — относительно корня, в posix-форме. Корень не исключается: иначе watcher не стартовал бы. */
export function isExcluded(rootPath: string, candidate: string, excludes: readonly string[]): boolean {
    const relative = path.relative(rootPath, candidate);
    if (relative === "") return false;
    return matchAnyGlob(excludes, relative.split(path.sep).join("/"));
}
