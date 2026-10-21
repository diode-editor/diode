import type { IDisposable } from "../../../base/common/lifecycle.ts";

/** Matches `vscode.FileChangeType` one to one. */
export type TreeFileChangeType = "created" | "changed" | "deleted";

export interface ITreeFileChange {
    readonly type: TreeFileChangeType;
    /** Absolute, in OS form (with `\` on Windows). */
    readonly path: string;
}

export interface ITreeFileWatchOptions {
    /** Otherwise only direct children. */
    readonly recursive: boolean;
    /**
     * Globs relative to `rootPath` (posix form) that the watcher never enters at all,
     * not a post-filter: otherwise `node_modules` eats the inotify limit. Required:
     * "watch everything" is a deliberate `[]`.
     */
    readonly excludes: readonly string[];
}

/**
 * Events arrive in **batches** (coalesced over tens of ms): a checkout or a build
 * means hundreds of changes, and calling the consumer for each would force it to
 * debounce on its own.
 */
export interface ITreeFileWatcher {
    /** Each call is an independent subscription, even if the implementation shares one traversal under them. */
    watchTree(
        rootPath: string,
        options: ITreeFileWatchOptions,
        onChanges: (changes: readonly ITreeFileChange[]) => void,
    ): IDisposable;
}

export const NULL_TREE_FILE_WATCHER: ITreeFileWatcher = {
    watchTree(): IDisposable {
        return {
            dispose: () => {
                /* no-op */
            },
        };
    },
};
