import * as path from "node:path";

import { matchAnyGlob, matchGlob } from "../../../base/common/glob.ts";

/**
 * Прямо на диске субпроцесса, а не через RPC: главный цикл редактора уже голодал
 * от рекурсивного обхода, а `redhat.java` зовёт `findFiles` около десяти раз за активацию.
 */

export interface IFindFilesEntry {
    readonly name: string;
    readonly isDirectory: boolean;
}

/** Обязан отвечать, а не бросать: каталог без прав не срывает поиск (ripgrep эталона его пропускает). */
export interface IFindFilesScanner {
    readDirectory(absolutePath: string): Promise<readonly IFindFilesEntry[]>;
}

/** Страховка: `findFiles("**\/*.java")` на домашнем каталоге не должен держать активацию вечно. */
export const DEFAULT_MAX_DIRECTORIES = 5000;

export interface IFindFilesRequest {
    /** Абсолютный путь корня поиска (база `GlobPattern`). */
    readonly base: string;
    readonly include: string;
    /**
     * Пустая строка (её шлёт `redhat.java`) компилируется в `^$` и ни с чем не
     * совпадает — особого случая не нужно.
     */
    readonly excludes: readonly string[];
    /** Верхняя граница результата; `undefined` или `Infinity` — без границы. */
    readonly maxResults?: number;
}

export interface IFindFilesOptions {
    readonly maxDirectories?: number;
    readonly isCancelled?: () => boolean;
}

/**
 * Только файлы, posix-пути от базы: `**\/build` не возвращает каталог сборки.
 * Обход в ширину: при `maxResults: 1` (частый у `redhat.java`) находится
 * ближайшее совпадение, а не первое в глубине.
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
                // Относительный posix от базы: так якорится `matchGlob` (`*` не переходит `/`).
                const relativePath = dir.relativePath === "" ? entry.name : `${dir.relativePath}/${entry.name}`;
                // `**\/node_modules` отсекает сам каталог, и обход в него не заходит;
                // `**\/node_modules/**` режет каждый файл внутри — результат тот же, дороже.
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
 * Шаблон без `**` фиксирует число сегментов — глубже искать незачем. Оценка
 * сверху: `/` внутри `{a/b,c}` завышает глубину, но лишний уровень безопаснее
 * пропущенного совпадения.
 */
function maxGlobDepth(glob: string): number {
    if (glob.includes("**")) return Number.POSITIVE_INFINITY;
    return glob.split("/").length - 1;
}
