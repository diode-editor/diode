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

/** Directories and files are indistinguishable, as in VS Code. */
const EVENT_TYPES: Partial<Record<string, TreeFileChangeType>> = {
    add: "created",
    addDir: "created",
    change: "changed",
    unlink: "deleted",
    unlinkDir: "deleted",
};

/**
 * Excludes are an `ignored` predicate, not a post-event filter: it is also called on
 * directories during the walk, so the watcher never enters `node_modules` or spends inotify on it.
 *
 * The walk doesn't follow symlinks inside the tree, like upstream's parcel-watcher: otherwise
 * `bazel-out` drags in the whole Bazel cache outside the workspace. A linked directory is watched
 * by an explicit request: the **root** resolves to the real path, and event paths are rewritten
 * back to the original (like upstream's `normalizePath`).
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
        // No root yet: watch the original path, chokidar waits for it to appear.
        const watchPath = realpathOrSelf(rootPath);
        const watcher = this.createWatcher(watchPath, options);
        const toOriginal = (changed: string): string => path.join(rootPath, path.relative(watchPath, changed));
        let pending: ITreeFileChange[] = [];
        let timer: ReturnType<typeof setTimeout> | null = null;

        // A batch is never empty: the first event arms the timer, and dispose clears it with what's pending.
        const flush = (): void => {
            timer = null;
            const batch = pending;
            pending = [];
            onChanges(batch);
        };

        // chokidar 5 with `followSymlinks: false` emits `add` for every symlink of the
        // initial walk despite `ignoreInitial` (`_handleSymlink`); mute until `ready`.
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

        // Without an 'error' listener chokidar crashes the process with an unhandledRejection
        // (typically ENOSPC, the inotify limit is exhausted); the watcher is dead after an error.
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

/** Matches the path relative to the root, in posix form. The root is never excluded, otherwise the watcher wouldn't start. */
export function isExcluded(rootPath: string, candidate: string, excludes: readonly string[]): boolean {
    const relative = path.relative(rootPath, candidate);
    if (relative === "") return false;
    return matchAnyGlob(excludes, relative.split(path.sep).join("/"));
}
