import chokidar, { type FSWatcher } from "chokidar";

import type { IDisposable } from "@tuidom/all/common/disposable";
import type { ILogger } from "../../log/common/iLogger.ts";
import { describeFileWatchError } from "../common/fileWatchErrors.ts";
import type { IFileWatcher } from "../common/iFileWatcher.ts";

/**
 * Реальная реализация {@link IFileWatcher} поверх chokidar (та же зависимость,
 * что и в дереве файлов). Следит за одним файлом; любое событие (`change`,
 * `add` после атомарного save-by-rename, `unlink`) прокидывается в `onChange`.
 *
 * Дебаунсит всплеск событий (атомарная запись = unlink+add за пару миллисекунд),
 * чтобы потребитель перечитал диск один раз, а не на каждый чих.
 */
export class ChokidarFileWatcher implements IFileWatcher {
    private readonly logger: ILogger | undefined;

    public constructor(logger?: ILogger) {
        this.logger = logger;
    }

    public watchFile(filePath: string, onChange: () => void): IDisposable {
        const watcher = this.createWatcher(filePath);
        let timer: ReturnType<typeof setTimeout> | null = null;

        const notify = (): void => {
            if (timer !== null) clearTimeout(timer);
            timer = setTimeout(() => {
                timer = null;
                onChange();
            }, 50);
        };

        watcher.on("change", notify);
        watcher.on("add", notify);
        watcher.on("unlink", notify);

        // Слушатель 'error' обязателен: без него EventEmitter chokidar'а бросает
        // исключение из своих async-потрохов, оно всплывает как unhandledRejection
        // и убивает процесс (типовой случай — ENOSPC, исчерпан лимит inotify:
        // следим за settings.json, а chokidar под капотом watch'ит его каталог).
        // Живой watcher после такой ошибки всё равно мёртв — закрываем его и живём
        // без live-reload этого файла, но с работающим редактором.
        watcher.on("error", (error) => {
            const { code, hint } = describeFileWatchError(error);
            this.logger?.warn(`file watcher error${hint}`, { filePath, code, error: String(error) });
            void watcher.close();
        });

        return {
            dispose: () => {
                if (timer !== null) {
                    clearTimeout(timer);
                    timer = null;
                }
                void watcher.close();
            },
        };
    }

    /** Шов для тестов: подменяемое создание реального chokidar-watcher'а. */
    protected createWatcher(filePath: string): FSWatcher {
        return chokidar.watch(filePath, { ignoreInitial: true });
    }
}
