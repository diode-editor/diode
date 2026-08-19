import * as path from "node:path";

import chokidar, { type FSWatcher } from "chokidar";

import type { IDisposable } from "@tuidom/core/common/disposable";
import { matchAnyGlob } from "../../../base/common/glob.ts";
import type { ILogger } from "../../log/common/iLogger.ts";
import { describeFileWatchError } from "../common/fileWatchErrors.ts";
import type { ITreeFileChange, ITreeFileWatcher, ITreeFileWatchOptions, TreeFileChangeType } from "../common/iTreeFileWatcher.ts";

/**
 * Окно коалесинга событий, мс. Одна пользовательская операция (checkout,
 * сборка, `npm install`) — это сотни событий подряд; потребителю нужен один
 * батч, а не сотня вызовов.
 */
const COALESCE_MS = 50;

/** Событие chokidar → вид изменения. Каталоги и файлы неразличимы (как в VS Code). */
const EVENT_TYPES: Record<string, TreeFileChangeType> = {
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
        const watcher = this.createWatcher(rootPath, options);
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

        watcher.on("all", (event, changedPath) => {
            const type = EVENT_TYPES[event];
            // `ready`/`raw` и прочие служебные события — не изменения файлов.
            if (type === undefined || typeof changedPath !== "string") return;
            pending.push({ type, path: changedPath });
            if (timer === null) timer = setTimeout(flush, COALESCE_MS);
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
            ignored: excludes.length === 0 ? undefined : (candidate: string) => isExcluded(rootPath, candidate, excludes),
        });
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
