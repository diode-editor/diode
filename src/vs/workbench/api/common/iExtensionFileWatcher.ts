import type { IDisposable } from "@tuidom/core/common/disposable";
import type { ITreeFileChange } from "../../../platform/files/common/iTreeFileWatcher.ts";

/**
 * Тонкий «port» поверх наблюдателя за деревом каталогов, нужный
 * {@link ExtensionHost} для `workspace.createFileSystemWatcher` расширений.
 *
 * От `ITreeFileWatcher` отличается ровно одним: excludes здесь не параметр, а
 * забота реализации — их источник (`files.watcherExclude`) живёт в
 * конфигурации, про которую host знать не должен. Паттерн повторяет
 * {@link IFileDecorationsService}: адаптер живёт в слое Extensions.
 */
export interface IExtensionFileWatcher {
    /**
     * Начинает следить за `base` (абсолютный путь каталога). События приходят
     * пачками; фильтрацией по glob-шаблону расширения занимается host.
     */
    watch(base: string, recursive: boolean, onChanges: (changes: readonly ITreeFileChange[]) => void): IDisposable;
}

/** No-op реализация — для тестов/профилей без файлового слежения. */
export const NULL_EXTENSION_FILE_WATCHER: IExtensionFileWatcher = {
    watch: () => ({
        dispose: () => undefined,
    }),
};
