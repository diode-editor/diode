import type { IDisposable } from "@tuidom/core/common/disposable";
import type { ITreeFileChange, ITreeFileWatcher } from "../../../platform/files/common/iTreeFileWatcher.ts";
import type { IExtensionFileWatcher } from "../common/iExtensionFileWatcher.ts";

/**
 * Реализация {@link IExtensionFileWatcher} поверх {@link ITreeFileWatcher}:
 * добавляет к нему единственное, чего не хватает host'у, — excludes из
 * настройки `files.watcherExclude`.
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

/**
 * Разбирает значение `files.watcherExclude` в список активных шаблонов.
 * Формат VS Code — карта `{ "<glob>": true }`, где `false` временно выключает
 * шаблон, не удаляя его из настроек.
 */
export function parseWatcherExclude(value: unknown): string[] {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
    return Object.entries(value as Record<string, unknown>)
        .filter(([, enabled]) => enabled === true)
        .map(([pattern]) => pattern);
}
