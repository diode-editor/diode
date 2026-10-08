import * as fs from "node:fs";
import * as path from "node:path";

import chokidar, { type ChokidarOptions, type FSWatcher } from "chokidar";

import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { ILogger } from "../../log/common/iLogger.ts";
import { describeFileWatchError } from "../common/fileWatchErrors.ts";
import type { IFileWatcher } from "../common/iFileWatcher.ts";

/** Что именно отдать chokidar'у: сам файл либо ближайший существующий предок. */
interface IWatchTarget {
    readonly path: string;
    readonly options: ChokidarOptions;
    /** Сегмент пути к файлу, появления которого ждём под предком; `null` — следим за самим файлом. */
    readonly awaitedChild: string | null;
}

/**
 * Реальная реализация {@link IFileWatcher} поверх chokidar (та же зависимость,
 * что и в дереве файлов). Следит за одним файлом; любое событие (`change`,
 * `add` после атомарного save-by-rename, `unlink`) прокидывается в `onChange`.
 *
 * Дебаунсит всплеск событий (атомарная запись = unlink+add за пару миллисекунд),
 * чтобы потребитель перечитал диск один раз, а не на каждый чих.
 *
 * **Файл, у которого ещё нет каталога** (`<папка>/.diode/settings.json` до
 * первой записи, `User/settings.json` свежего профиля), chokidar молча не
 * видит: он вешает watch на родительский каталог, а того нет — и создание
 * каталога с файлом не даёт ни одного события (проверено пробой). Поэтому в
 * таком случае следим за ближайшим **существующим** предком без рекурсии
 * (`depth: 0`, из соседей пропускается только ожидаемый сегмент), а на
 * появление сегмента перевешиваемся ближе к файлу — пока не дойдём до него
 * самого. Файл, успевший появиться к моменту перевешивания, считается
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
            const target = this.watchTarget(filePath);
            const created = this.createWatcher(target.path, target.options);
            watcher = created;

            if (target.awaitedChild === null) {
                created.on("change", notify);
                created.on("add", notify);
                created.on("unlink", () => {
                    notify();
                    // Снесли каталог целиком (`rm -rf .diode`) — watch на нём мёртв,
                    // ждём каталог заново. Удаление одного файла каталог не трогает.
                    // Stryker disable next-line BooleanLiteral: каталога нет — значит, нет и файла; «мог появиться» проверит exists и ничего не найдёт
                    if (!this.exists(path.dirname(filePath))) rearm(false);
                });
            } else {
                // Ждём ровно один сегмент: всё остальное отфильтровано `ignored`.
                created.on("addDir", () => {
                    rearm(true);
                });
            }

            // Слушатель 'error' обязателен: без него EventEmitter chokidar'а бросает
            // исключение из своих async-потрохов, оно всплывает как unhandledRejection
            // и убивает процесс (типовой случай — ENOSPC, исчерпан лимит inotify:
            // следим за settings.json, а chokidar под капотом watch'ит его каталог).
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
     * Сам файл, если его каталог существует; иначе — ближайший существующий
     * предок с ожиданием недостающего сегмента под ним.
     */
    private watchTarget(filePath: string): IWatchTarget {
        let awaited = path.dirname(filePath);
        if (this.exists(awaited)) return { path: filePath, options: { ignoreInitial: true }, awaitedChild: null };
        let ancestor = path.dirname(awaited);
        while (!this.exists(ancestor) && ancestor !== path.dirname(ancestor)) {
            awaited = ancestor;
            ancestor = path.dirname(ancestor);
        }
        return {
            path: ancestor,
            options: {
                ignoreInitial: true,
                depth: 0,
                ignored: (candidate: string) => candidate !== ancestor && candidate !== awaited,
            },
            awaitedChild: awaited,
        };
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
