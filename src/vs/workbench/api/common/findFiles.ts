import * as path from "node:path";

import { matchAnyGlob, matchGlob } from "../../../base/common/glob.ts";

/**
 * `vscode.workspace.findFiles` на стороне subprocess.
 *
 * Как и `workspace.fs`, идёт **прямо на диск субпроцесса**, а не через RPC: дерево живёт
 * на той же машине, и обход в субпроцессе — не компромисс, а правильное место.
 * Главный цикл редактора уже однажды голодал из-за рекурсивного обхода
 * (`files.watcherExclude`, вынос watcher'а в отдельный процесс), а `redhat.java`
 * зовёт `findFiles` около десяти раз подряд на одной активации.
 *
 * Логика обхода отделена от ФС интерфейсом {@link IFindFilesScanner} — так
 * бюджет, исключения и матчинг проверяются на карте каталогов в памяти;
 * настоящая ФС — `createNodeFindFilesScanner` в `api/node/extHostDisk.ts`.
 */

/** Запись каталога: имени и признака каталога обходу достаточно. */
export interface IFindFilesEntry {
    readonly name: string;
    readonly isDirectory: boolean;
}

/**
 * Доступ к дереву для поиска. Обязан отвечать, а не бросать: каталог без прав
 * доступа не должен срывать весь поиск (в эталоне за `findFiles` стоит ripgrep,
 * который такой каталог просто пропускает).
 */
export interface IFindFilesScanner {
    readDirectory(absolutePath: string): Promise<readonly IFindFilesEntry[]>;
}

/**
 * Сколько каталогов максимум читаем на один запрос. Страховка от гигантского
 * дерева: `findFiles("**\/*.java")` на домашнем каталоге не должен держать
 * активацию вечно. Совпадает по духу с бюджетом `workspaceContains:`-активации.
 */
export const DEFAULT_MAX_DIRECTORIES = 5000;

export interface IFindFilesRequest {
    /** Абсолютный путь корня поиска (база `GlobPattern`). */
    readonly base: string;
    /** Шаблон относительно базы (`**\/pom.xml`). */
    readonly include: string;
    /**
     * Шаблоны исключения относительно той же базы; пустой набор — не исключать
     * ничего. Набор, а не один шаблон, потому что дефолт берётся из настройки
     * `files.exclude` — это карта шаблонов (см. `excludeSettings.ts`).
     *
     * Отдельной обработки пустой строки среди них нет и не нужно (её шлёт
     * `redhat.java`, когда исключений не набралось): пустой glob компилируется
     * в `^$` и ни с каким путём не совпадает.
     */
    readonly excludes: readonly string[];
    /** Верхняя граница результата; `undefined` или `Infinity` — без границы. */
    readonly maxResults?: number;
}

export interface IFindFilesOptions {
    readonly maxDirectories?: number;
    /** Отмена поиска (`CancellationToken` расширения). */
    readonly isCancelled?: () => boolean;
}

/**
 * Пути найденных ФАЙЛОВ относительно базы, в posix-форме.
 *
 * Именно файлов: `findFiles` по контракту ищет файлы, каталог под шаблон не
 * попадает (`**\/build` не должен возвращать каталог сборки).
 *
 * Обход — в ШИРИНУ: реальные шаблоны мелкие (`**\/pom.xml`,
 * `*.java`), а `maxResults: 1` у `redhat.java` встречается чаще остальных —
 * ближайшее совпадение обязано находиться, не спускаясь в первую попавшуюся
 * ветку целиком.
 */
export async function findFiles(
    scanner: IFindFilesScanner,
    request: IFindFilesRequest,
    options: IFindFilesOptions = {},
): Promise<string[]> {
    const limit = request.maxResults ?? Number.POSITIVE_INFINITY;
    const found: string[] = [];
    if (limit <= 0) return found;

    const maxDirectories = options.maxDirectories ?? DEFAULT_MAX_DIRECTORIES;
    const isCancelled = (): boolean => options.isCancelled?.() === true;
    const excludes = request.excludes;
    const maxDepth = maxGlobDepth(request.include);

    let frontier: { absolutePath: string; relativePath: string }[] = [{ absolutePath: request.base, relativePath: "" }];
    let read = 0;
    for (let depth = 0; depth <= maxDepth && frontier.length > 0; depth++) {
        const next: typeof frontier = [];
        for (const dir of frontier) {
            if (isCancelled() || read >= maxDirectories) return found;
            read++;
            for (const entry of await scanner.readDirectory(dir.absolutePath)) {
                // Путь для матчинга — ОТНОСИТЕЛЬНЫЙ posix, от базы: ровно так
                // якорится `matchGlob` (`*` не переходит `/`), и ровно это
                // имеет в виду `findFiles("*/pom.xml")`.
                const relativePath = dir.relativePath === "" ? entry.name : `${dir.relativePath}/${entry.name}`;
                // Исключение режет и файлы, и каталоги: шаблон вида
                // `**\/node_modules` совпадает с самим каталогом, и обход в него
                // не заходит вовсе. Форма `**\/node_modules/**` с каталогом не
                // совпадает — тогда отсекается каждый файл внутри, результат тот
                // же, просто дороже.
                if (matchAnyGlob(excludes, relativePath)) continue;
                if (entry.isDirectory) {
                    next.push({ absolutePath: path.join(dir.absolutePath, entry.name), relativePath });
                    continue;
                }
                if (!matchGlob(request.include, relativePath)) continue;
                found.push(relativePath);
                if (found.length >= limit) return found;
            }
        }
        frontier = next;
    }
    return found;
}

/**
 * Глубина каталогов, глубже которой совпадения быть не может. Шаблон без `**`
 * фиксирует число сегментов пути, поэтому спускаться дальше незачем: `*.java`
 * читает только корень, `*\/pom.xml` — корень и первый уровень. `**`
 * снимает ограничение — там работает только бюджет каталогов.
 *
 * Оценка сверху: разбиение по `/` внутри `{a/b,c}` завышает число сегментов, но
 * лишний уровень обхода безопаснее пропущенного совпадения.
 */
function maxGlobDepth(glob: string): number {
    if (glob.includes("**")) return Number.POSITIVE_INFINITY;
    return glob.split("/").length - 1;
}
