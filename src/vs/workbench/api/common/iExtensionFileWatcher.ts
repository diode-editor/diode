import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { ITreeFileChange } from "../../../platform/files/common/iTreeFileWatcher.ts";

/**
 * Excludes are the implementation's concern, not a parameter as in `ITreeFileWatcher`: their
 * source `files.watcherExclude` lives in configuration the host knows nothing about.
 */
export interface IExtensionFileWatcher {
    /** `base` is an absolute directory path; the host does the glob filtering. */
    watch(base: string, recursive: boolean, onChanges: (changes: readonly ITreeFileChange[]) => void): IDisposable;
}

export const NULL_EXTENSION_FILE_WATCHER: IExtensionFileWatcher = {
    watch: () => ({
        dispose: () => undefined,
    }),
};
