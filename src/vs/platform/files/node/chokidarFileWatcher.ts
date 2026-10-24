import * as fs from "node:fs";
import * as path from "node:path";

import chokidar, { type ChokidarOptions, type FSWatcher } from "chokidar";

import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { ILogger } from "../../log/common/iLogger.ts";
import { describeFileWatchError } from "../common/fileWatchErrors.ts";
import type { IFileWatcher } from "../common/iFileWatcher.ts";

interface IWatchTarget {
    readonly directory: string;
    /** The file itself or the missing directory on the way to it. */
    readonly awaited: string;
}

/**
 * The form in which chokidar passes a path to the `ignored` predicate (forward slashes):
 * on Windows comparing against the native path would drop everything, the file included.
 */
export function toChokidarPath(fsPath: string): string {
    return fsPath.replaceAll("\\", "/");
}

/**
 * Coalesces event bursts into one callback per {@link WATCH_COALESCE_MS} window: an atomic write is unlink+add
 * within a couple of milliseconds. The window starts with the first event and is not extended by the next ones
 * (a throttle, not a debounce): a log appended every few milliseconds would otherwise never be reported, and
 * follow (docs/arch/Editor.md) rides on these callbacks — the window is also its frame rate cap.
 *
 * **Chokidar gets the file's directory, not the file itself** (`depth: 0`, siblings
 * filtered out). For a file root chokidar holds an `fs.watch` on the inode, shared
 * process-wide across instances; an atomic save changes the inode, the first one to
 * notice re-subscribes to the same dead shared `fs.watch`, and both go silent.
 * And `settings.json` has two watchers: the document model and the configuration
 * service (`chokidarFileWatcher.atomicSave.test.ts`). The directory inode doesn't change.
 *
 * **No directory** (`.diode/settings.json` before the first write): watch the nearest
 * existing ancestor and move closer to the file as segments appear. A file that already
 * appeared by the time we move counts as a change: `ignoreInitial` would not report it.
 */
export const WATCH_COALESCE_MS = 50;

export class ChokidarFileWatcher implements IFileWatcher {
    private readonly logger: ILogger | undefined;

    public constructor(logger?: ILogger) {
        this.logger = logger;
    }

    public watchFile(filePath: string, onChange: () => void): IDisposable {
        let watcher: FSWatcher | null = null;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const notify = (): void => {
            if (timer !== null) return;
            timer = setTimeout(() => {
                timer = null;
                onChange();
            }, WATCH_COALESCE_MS);
        };

        /** `fileMayExist`: the file may have appeared while we weren't watching. */
        const rearm = (fileMayExist: boolean): void => {
            // Stryker disable next-line OptionalChaining: rearm is only called from events of a live watcher, so it's not null; `?.` is for the type
            void watcher?.close();
            watcher = null;
            arm();
            if (fileMayExist && this.exists(filePath)) notify();
        };

        const arm = (): void => {
            const { directory, awaited } = this.watchTarget(filePath);
            const kept = new Set([toChokidarPath(directory), toChokidarPath(awaited)]);
            const created = this.createWatcher(directory, {
                ignoreInitial: true,
                depth: 0,
                ignored: (candidate: string) => !kept.has(candidate),
            });
            watcher = created;

            if (awaited === filePath) {
                created.on("change", notify);
                created.on("add", notify);
                created.on("unlink", () => {
                    notify();
                    // The whole directory is gone (`rm -rf .diode`): the watch on it is dead.
                    // Stryker disable next-line BooleanLiteral: no directory means no file; "may have appeared" would check exists and find nothing
                    if (!this.exists(directory)) rearm(false);
                });
            } else {
                created.on("addDir", () => {
                    rearm(true);
                });
            }

            // Without an 'error' listener chokidar crashes the process with an unhandledRejection
            // (typically ENOSPC, the inotify limit is exhausted); the watcher is dead after an error.
            created.on("error", (error) => {
                const { code, hint } = describeFileWatchError(error);
                this.logger?.warn(`file watcher error${hint}`, { filePath, code, error: String(error) });
                void created.close();
            });
        };

        arm();

        return {
            dispose: () => {
                if (timer !== null) {
                    clearTimeout(timer);
                    timer = null;
                }
                void watcher?.close();
                watcher = null;
            },
        };
    }

    private watchTarget(filePath: string): IWatchTarget {
        let awaited = filePath;
        let directory = path.dirname(filePath);
        while (!this.exists(directory) && directory !== path.dirname(directory)) {
            awaited = directory;
            directory = path.dirname(directory);
        }
        return { directory, awaited };
    }

    protected createWatcher(target: string, options: ChokidarOptions): FSWatcher {
        return chokidar.watch(target, options);
    }

    protected exists(candidate: string): boolean {
        return fs.existsSync(candidate);
    }
}
