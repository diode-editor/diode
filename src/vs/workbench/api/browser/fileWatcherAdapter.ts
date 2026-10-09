import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { ITreeFileChange, ITreeFileWatcher } from "../../../platform/files/common/iTreeFileWatcher.ts";
import type { IExtensionFileWatcher } from "../common/iExtensionFileWatcher.ts";

/**
 * Реализация {@link IExtensionFileWatcher} поверх {@link ITreeFileWatcher}:
 * добавляет к нему то, чего не хватает host'у, — excludes из настройки
 * `files.watcherExclude` (разбор — `watcherExcludeGlobs` в
 * `common/configuration/excludeSettings.ts`) и дополнительные корни из
 * `files.watcherInclude` (каталоги-симлинки внутри базы, за которые обход сам
 * не заходит; разрешение — `watcherIncludesUnder` в `api/node/watcherIncludes.ts`).
 *
 * Обе настройки читаются **на каждый** `watch()`, а не запоминаются в
 * конструкторе: настройка живая, и расширение, поднявшее watcher после её
 * правки, должно увидеть новый набор.
 */
export class FileWatcherAdapter implements IExtensionFileWatcher {
    public constructor(
        private readonly watcher: ITreeFileWatcher,
        private readonly excludes: () => readonly string[],
        private readonly includesUnder: (base: string) => readonly string[] = () => [],
    ) {}

    public watch(
        base: string,
        recursive: boolean,
        onChanges: (changes: readonly ITreeFileChange[]) => void,
    ): IDisposable {
        const options = { recursive, excludes: this.excludes() };
        const main = this.watcher.watchTree(base, options, onChanges);
        // Нерекурсивному watcher'у поддерево не нужно — и include тоже.
        if (!recursive) return main;
        const extra = this.includesUnder(base).map((include) => this.watcher.watchTree(include, options, onChanges));
        return {
            dispose: () => {
                main.dispose();
                for (const subscription of extra) subscription.dispose();
            },
        };
    }
}
