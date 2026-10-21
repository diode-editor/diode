import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { ITreeFileChange } from "../../../platform/files/common/iTreeFileWatcher.ts";

/**
 * Excludes — забота реализации, а не параметр, как у `ITreeFileWatcher`: их
 * источник `files.watcherExclude` живёт в конфигурации, о которой host не знает.
 */
export interface IExtensionFileWatcher {
    /** `base` — абсолютный путь каталога; glob-фильтрацией занимается host. */
    watch(base: string, recursive: boolean, onChanges: (changes: readonly ITreeFileChange[]) => void): IDisposable;
}

export const NULL_EXTENSION_FILE_WATCHER: IExtensionFileWatcher = {
    watch: () => ({
        dispose: () => undefined,
    }),
};
