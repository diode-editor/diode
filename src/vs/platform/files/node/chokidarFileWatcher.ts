import * as fs from "node:fs";
import * as path from "node:path";

import chokidar, { type ChokidarOptions, type FSWatcher } from "chokidar";

import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { ILogger } from "../../log/common/iLogger.ts";
import { describeFileWatchError } from "../common/fileWatchErrors.ts";
import type { IFileWatcher } from "../common/iFileWatcher.ts";

interface IWatchTarget {
    readonly directory: string;
    /** Сам файл либо недостающий каталог на пути к нему. */
    readonly awaited: string;
}

/**
 * Форма, в какой chokidar отдаёт путь предикату `ignored` (прямые слэши): на
 * Windows сравнение с родным путём отбросило бы всё, и сам файл.
 */
export function toChokidarPath(fsPath: string): string {
    return fsPath.replaceAll("\\", "/");
}

/**
 * Дебаунсит всплеск событий: атомарная запись — unlink+add за пару миллисекунд.
 *
 * **Chokidar'у отдаём каталог файла, а не сам файл** (`depth: 0`, соседи
 * отфильтрованы). За файлом-корнем chokidar держит `fs.watch` на inode, общий
 * на процесс для всех экземпляров; атомарное сохранение меняет inode, первый
 * заметивший переподписывается на тот же мёртвый общий `fs.watch` — и глохнут
 * оба, молча. А `settings.json` смотрят двое: модель документа и сервис
 * настроек (`chokidarFileWatcher.atomicSave.test.ts`). Inode каталога не меняется.
 *
 * **Нет каталога** (`.diode/settings.json` до первой записи) — следим за
 * ближайшим существующим предком и перевешиваемся ближе к файлу по мере
 * появления сегментов. Файл, успевший появиться к перевешиванию, — изменение:
 * `ignoreInitial` его бы не отдал.
 */
export class ChokidarFileWatcher implements IFileWatcher {
    private readonly logger: ILogger | undefined;

    public constructor(logger?: ILogger) {
        this.logger = logger;
    }

    public watchFile(filePath: string, onChange: () => void): IDisposable {
        let watcher: FSWatcher | null = null;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const notify = (): void => {
            if (timer !== null) clearTimeout(timer);
            timer = setTimeout(() => {
                timer = null;
                onChange();
            }, 50);
        };

        /** `fileMayExist` — файл мог появиться, пока нас не было. */
        const rearm = (fileMayExist: boolean): void => {
            // Stryker disable next-line OptionalChaining: rearm зовут только события живого watcher'а — он не null; `?.` нужен типу
            void watcher?.close();
            watcher = null;
            arm();
            if (fileMayExist && this.exists(filePath)) notify();
        };

        const arm = (): void => {
            const { directory, awaited } = this.watchTarget(filePath);
            const kept = new Set([toChokidarPath(directory), toChokidarPath(awaited)]);
            const created = this.createWatcher(directory, {
                ignoreInitial: true,
                depth: 0,
                ignored: (candidate: string) => !kept.has(candidate),
            });
            watcher = created;

            if (awaited === filePath) {
                created.on("change", notify);
                created.on("add", notify);
                created.on("unlink", () => {
                    notify();
                    // Снесли каталог целиком (`rm -rf .diode`) — watch на нём мёртв.
                    // Stryker disable next-line BooleanLiteral: каталога нет — значит, нет и файла; «мог появиться» проверит exists и ничего не найдёт
                    if (!this.exists(directory)) rearm(false);
                });
            } else {
                created.on("addDir", () => {
                    rearm(true);
                });
            }

            // Без слушателя 'error' chokidar роняет процесс unhandledRejection'ом
            // (типично ENOSPC — исчерпан лимит inotify); watcher после ошибки мёртв.
            created.on("error", (error) => {
                const { code, hint } = describeFileWatchError(error);
                this.logger?.warn(`file watcher error${hint}`, { filePath, code, error: String(error) });
                void created.close();
            });
        };

        arm();

        return {
            dispose: () => {
                if (timer !== null) {
                    clearTimeout(timer);
                    timer = null;
                }
                void watcher?.close();
                watcher = null;
            },
        };
    }

    private watchTarget(filePath: string): IWatchTarget {
        let awaited = filePath;
        let directory = path.dirname(filePath);
        while (!this.exists(directory) && directory !== path.dirname(directory)) {
            awaited = directory;
            directory = path.dirname(directory);
        }
        return { directory, awaited };
    }

    protected createWatcher(target: string, options: ChokidarOptions): FSWatcher {
        return chokidar.watch(target, options);
    }

    protected exists(candidate: string): boolean {
        return fs.existsSync(candidate);
    }
}
