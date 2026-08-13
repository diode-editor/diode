import type { IDisposable } from "@tuidom/all/common/disposable";

/**
 * Наблюдатель за отдельными файлами на диске. Абстрагирует реальный
 * файловый watcher (chokidar/fs.watch) от потребителей, чтобы логику
 * «файл поменялся снаружи» можно было гонять в юнит-тестах детерминированно
 * (через фейк, который триггерит колбэк вручную).
 *
 * Это чистый IO-примитив (без DI и внешних зависимостей) — он живёт в Common
 * рядом с {@link IClipboard}/{@link IFileClipboard}, чтобы им могли пользоваться
 * и слой Workbench (через `IFileWatcherDIToken`), и слой Configuration
 * (напрямую, для live-reload настроек). Единственная реализация с реальным IO —
 * `ChokidarFileWatcher` (слой Workbench); в тестах используется
 * {@link NULL_FILE_WATCHER} или ручной фейк.
 */
export interface IFileWatcher {
    /**
     * Начинает следить за одним файлом. `onChange` вызывается, когда файл на
     * диске изменился/пересоздан/удалён (без разбора — потребитель сам решает,
     * что делать, сверяясь со stat). Возвращает disposable для остановки.
     */
    watchFile(filePath: string, onChange: () => void): IDisposable;
}

/** No-op наблюдатель: ничего не отслеживает (тесты, окружения без live-watch). */
export const NULL_FILE_WATCHER: IFileWatcher = {
    watchFile(): IDisposable {
        return {
            dispose: () => {
                /* no-op */
            },
        };
    },
};
