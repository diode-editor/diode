import type { IDisposable } from "../../../base/common/lifecycle.ts";

/** Один-в-один `vscode.FileChangeType`. */
export type TreeFileChangeType = "created" | "changed" | "deleted";

export interface ITreeFileChange {
    readonly type: TreeFileChangeType;
    /** Абсолютный, в форме ОС (на Windows — с `\`). */
    readonly path: string;
}

export interface ITreeFileWatchOptions {
    /** Иначе — только прямые дети. */
    readonly recursive: boolean;
    /**
     * Glob относительно `rootPath` (posix-форма), куда watcher не заходит вовсе —
     * не постфильтр: `node_modules` иначе съедает лимит inotify. Обязательное:
     * «следить за всем» — осознанный `[]`.
     */
    readonly excludes: readonly string[];
}

/**
 * События приходят **пачками** (коалесинг в десятки мс): за checkout или
 * сборкой стоят сотни изменений, звать потребителя на каждое — заставить его
 * дебаунсить самому.
 */
export interface ITreeFileWatcher {
    /** Каждый вызов — независимая подписка, даже если реализация делит под ними один обход. */
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
