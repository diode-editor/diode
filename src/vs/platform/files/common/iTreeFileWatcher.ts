import type { IDisposable } from "@tuidom/core/common/disposable";

/** Что случилось с путём. Соответствует `vscode.FileChangeType` один-в-один. */
export type TreeFileChangeType = "created" | "changed" | "deleted";

/** Одно файловое событие: абсолютный путь и вид изменения. */
export interface ITreeFileChange {
    readonly type: TreeFileChangeType;
    /** Абсолютный путь в форме ОС (на Windows — с `\`). */
    readonly path: string;
}

export interface ITreeFileWatchOptions {
    /** Следить за поддеревом целиком; иначе — только за прямыми детьми каталога. */
    readonly recursive: boolean;
    /**
     * Glob-шаблоны (относительно `rootPath`, posix-форма), в которые watcher не
     * заходит вовсе. Это не постфильтр событий, а именно отказ обходить —
     * `node_modules` в большом репозитории иначе съедает лимит inotify.
     * Поле обязательное: «следить за всем» — это осознанный `[]`, а не забытый
     * аргумент.
     */
    readonly excludes: readonly string[];
}

/**
 * Наблюдатель за деревом каталогов. Второй примитив семейства рядом с
 * {@link IFileWatcher} (тот следит за одним файлом): здесь потребителя
 * интересует не «файл на диске изменился», а поток событий по поддереву —
 * его ждёт `workspace.createFileSystemWatcher` расширений и встроенный git,
 * который на каждое такое событие пересчитывает `git status`.
 *
 * События приходят **пачками**: за одной пользовательской операцией (checkout,
 * сборка, распаковка) стоят сотни изменений, и звать потребителя на каждое —
 * значит заставить его дебаунсить самому. Реализация коалесцирует их окном в
 * несколько десятков миллисекунд.
 *
 * Единственная реализация с реальным IO — `ChokidarTreeWatcher` (слой node);
 * в тестах — {@link NULL_TREE_FILE_WATCHER} или ручной фейк.
 */
export interface ITreeFileWatcher {
    /**
     * Начинает следить за `rootPath`. Возвращает disposable для остановки;
     * повторный вызов заводит независимый watcher (потребители не делят
     * подписку — у каждого свои excludes и своя рекурсивность).
     */
    watchTree(
        rootPath: string,
        options: ITreeFileWatchOptions,
        onChanges: (changes: readonly ITreeFileChange[]) => void,
    ): IDisposable;
}

/** No-op наблюдатель: ничего не отслеживает (тесты, окружения без live-watch). */
export const NULL_TREE_FILE_WATCHER: ITreeFileWatcher = {
    watchTree(): IDisposable {
        return {
            dispose: () => {
                /* no-op */
            },
        };
    },
};
