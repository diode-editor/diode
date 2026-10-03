import type { IDisposable } from "@tuidom/core/common/disposable";

import type { ITreeFileChange, ITreeFileWatcher } from "../../../platform/files/common/iTreeFileWatcher.ts";
import type { IExtensionFileWatcher } from "../common/iExtensionFileWatcher.ts";

/**
 * Реализация {@link IExtensionFileWatcher} поверх {@link ITreeFileWatcher}:
 * добавляет к нему единственное, чего не хватает host'у, — excludes из
 * настройки `files.watcherExclude` (разбор —
 * `watcherExcludeGlobs` в `common/configuration/excludeSettings.ts`).
 *
 * Excludes читаются **на каждый** `watch()`, а не запоминаются в конструкторе:
 * настройка живая, и расширение, поднявшее watcher после её правки, должно
 * увидеть новый набор.
 */
export class FileWatcherAdapter implements IExtensionFileWatcher {
    public constructor(
        private readonly watcher: ITreeFileWatcher,
        private readonly excludes: () => readonly string[],
    ) {}

    public watch(
        base: string,
        recursive: boolean,
        onChanges: (changes: readonly ITreeFileChange[]) => void,
    ): IDisposable {
        return this.watcher.watchTree(base, { recursive, excludes: this.excludes() }, onChanges);
    }
}
