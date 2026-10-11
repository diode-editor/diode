import * as fs from "node:fs";
import * as path from "node:path";

import chokidar, { type ChokidarOptions, type FSWatcher } from "chokidar";

import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { ILogger } from "../../log/common/iLogger.ts";
import { describeFileWatchError } from "../common/fileWatchErrors.ts";
import type { IFileWatcher } from "../common/iFileWatcher.ts";

/** Что отдать chokidar'у: ближайший существующий каталог на пути к файлу и сегмент под ним. */
interface IWatchTarget {
    /** Существующий каталог — корень chokidar'а. */
    readonly directory: string;
    /** Сегмент под ним, за которым следим: сам файл либо недостающий каталог на пути к нему. */
    readonly awaited: string;
}

/**
 * Реальная реализация {@link IFileWatcher} поверх chokidar (та же зависимость,
 * что и в дереве файлов). Следит за одним файлом; любое событие (`change`,
 * `add` после атомарного save-by-rename, `unlink`) прокидывается в `onChange`.
 *
 * Дебаунсит всплеск событий (атомарная запись = unlink+add за пару миллисекунд),
 * чтобы потребитель перечитал диск один раз, а не на каждый чих.
 *
 * **Chokidar'у отдаём каталог файла, а не сам файл** — без рекурсии
 * (`depth: 0`), из соседей пропускается только файл. За файлом-корнем chokidar
 * следит `fs.watch` на его inode, а этот `fs.watch` у него общий на процесс для
 * всех экземпляров, следящих за тем же путём. Атомарное сохранение (временный
 * сосед + `rename`, так пишет и наш редактор) меняет inode; экземпляр,
 * заметивший это первым, переподписывается — и попадает обратно на тот же
 * общий мёртвый `fs.watch`, который держит второй. Глохнут оба, и молча.
 * А за одним файлом у нас следят двое: открытый в редакторе `settings.json`
 * смотрят модель документа и сервис настроек, — и вторая же правка настроек
 * не применялась, а сохранение после записи снаружи упиралось в Overwrite
 * (проверено пробой и `chokidarFileWatcher.atomicSave.test.ts`). Inode каталога
 * при сохранении не меняется.
 *
 * **Файл, у которого ещё нет каталога** (`<папка>/.diode/settings.json` до
 * первой записи, `User/settings.json` свежего профиля), — тот же приём уровнем
 * выше: следим за ближайшим **существующим** предком, ожидая недостающий
 * сегмент, а на его появление перевешиваемся ближе к файлу — пока не дойдём до
 * его каталога. Файл, успевший появиться к моменту перевешивания, считается
 * изменением: `ignoreInitial` его бы не отдал.
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

        /** Перевешивает watch на актуальную цель; `fileMayExist` — файл мог появиться, пока нас не было. */
        const rearm = (fileMayExist: boolean): void => {
            // Stryker disable next-line OptionalChaining: rearm зовут только события живого watcher'а — он не null; `?.` нужен типу
            void watcher?.close();
            watcher = null;
            arm();
            if (fileMayExist && this.exists(filePath)) notify();
        };

        const arm = (): void => {
            const { directory, awaited } = this.watchTarget(filePath);
            const created = this.createWatcher(directory, {
                ignoreInitial: true,
                // Только прямые потомки, и из них — один ожидаемый сегмент:
                // соседи (src, node_modules проекта) не обходятся.
                depth: 0,
                ignored: (candidate: string) => candidate !== directory && candidate !== awaited,
            });
            watcher = created;

            if (awaited === filePath) {
                created.on("change", notify);
                created.on("add", notify);
                created.on("unlink", () => {
                    notify();
                    // Снесли каталог целиком (`rm -rf .diode`) — watch на нём мёртв,
                    // ждём каталог заново. Удаление одного файла каталог не трогает.
                    // Stryker disable next-line BooleanLiteral: каталога нет — значит, нет и файла; «мог появиться» проверит exists и ничего не найдёт
                    if (!this.exists(directory)) rearm(false);
                });
            } else {
                // Ждём ровно один сегмент: всё остальное отфильтровано `ignored`.
                created.on("addDir", () => {
                    rearm(true);
                });
            }

            // Слушатель 'error' обязателен: без него EventEmitter chokidar'а бросает
            // исключение из своих async-потрохов, оно всплывает как unhandledRejection
            // и убивает процесс (типовой случай — ENOSPC, исчерпан лимит inotify).
            // Живой watcher после такой ошибки всё равно мёртв — закрываем его и живём
            // без live-reload этого файла, но с работающим редактором.
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

    /**
     * Каталог файла и сам файл, если каталог существует; иначе — ближайший
     * существующий предок и недостающий сегмент под ним.
     */
    private watchTarget(filePath: string): IWatchTarget {
        let awaited = filePath;
        let directory = path.dirname(filePath);
        while (!this.exists(directory) && directory !== path.dirname(directory)) {
            awaited = directory;
            directory = path.dirname(directory);
        }
        return { directory, awaited };
    }

    /** Шов для тестов: подменяемое создание реального chokidar-watcher'а. */
    protected createWatcher(target: string, options: ChokidarOptions): FSWatcher {
        return chokidar.watch(target, options);
    }

    /** Шов для тестов: существует ли путь на диске. */
    protected exists(candidate: string): boolean {
        return fs.existsSync(candidate);
    }
}
