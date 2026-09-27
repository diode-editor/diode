import * as fs from "node:fs";
import * as path from "node:path";

import { CancellationTokenNone, type ICancellationToken } from "../../../../base/common/cancellation.ts";
import { matchGlob } from "../../../../base/common/glob.ts";
import type { IWorkspaceContainsPatterns } from "../common/activationEvents.ts";

/**
 * Совпадение `workspaceContains:`-паттернов расширения с содержимым открытых
 * папок воркспейса — вторая половина честного события активации (первая, разбор
 * паттернов по семантике, — в `../common/activationEvents.ts`).
 *
 * Доступ к ФС спрятан за {@link IWorkspaceScanner}: логика обхода (бюджет,
 * глубина, исключения) закрывается тестами на карте каталогов в памяти, а
 * настоящую ФС даёт {@link createNodeWorkspaceScanner}.
 */

/** Запись каталога: имени и признака каталога обходу достаточно. */
export interface IWorkspaceDirectoryEntry {
    readonly name: string;
    readonly isDirectory: boolean;
}

/**
 * Доступ к дереву воркспейса для активации. Обе операции ОБЯЗАНЫ отвечать, а не
 * бросать: активация — фоновая работа, и каталог без прав доступа не должен
 * ронять её для всех расширений сразу.
 */
export interface IWorkspaceScanner {
    /** Существует ли запись по абсолютному пути (файл ИЛИ каталог). */
    exists(absolutePath: string): Promise<boolean>;
    /** Записи каталога; недоступный/исчезнувший каталог — пустой список. */
    readDirectory(absolutePath: string): Promise<readonly IWorkspaceDirectoryEntry[]>;
}

/**
 * Каталоги, в которые обход не заходит. Совпадает с дефолтами `files.exclude`
 * эталона: в `node_modules` и `.git` `workspaceContains:`-паттерн имеет в виду
 * не то, что там найдётся (чужой `pom.xml` зависимости — не признак проекта).
 */
export const DEFAULT_WORKSPACE_CONTAINS_EXCLUDES: ReadonlySet<string> = new Set([".git", "node_modules"]);

/**
 * Сколько каталогов максимум читаем на одну папку воркспейса. Страховка от
 * гигантского дерева: без неё `workspaceContains:**\/x` на домашнем каталоге
 * держал бы старт. Обрыв по бюджету виден в {@link IWorkspaceContainsResult}.
 */
export const DEFAULT_MAX_DIRECTORIES = 5000;

export interface IWorkspaceContainsSearchOptions {
    /** Каталоги, в которые не заходим (по имени). По умолчанию — {@link DEFAULT_WORKSPACE_CONTAINS_EXCLUDES}. */
    readonly excludeDirectories?: ReadonlySet<string>;
    /** Бюджет прочитанных каталогов на папку. По умолчанию — {@link DEFAULT_MAX_DIRECTORIES}. */
    readonly maxDirectories?: number;
    /** Отмена обхода (у вызывающего — таймаут). По умолчанию не отменяется. */
    readonly token?: ICancellationToken;
}

export interface IWorkspaceContainsResult {
    /** Подошедший паттерн (он же причина активации для лога) либо `null`. */
    readonly pattern: string | null;
    /**
     * Обход оборвался, не дойдя до конца — по бюджету каталогов или по отмене.
     * `pattern === null` при `truncated` значит «не нашли», а не «нет»: причину
     * обязан сообщить вызывающий, иначе усечение читается как полный ответ.
     */
    readonly truncated: boolean;
}

/** Ответ «ничего не подошло, обход дошёл до конца» — самый частый. */
const NO_MATCH: IWorkspaceContainsResult = { pattern: null, truncated: false };

/**
 * Подошёл ли открытым папкам воркспейса хоть один `workspaceContains:`-паттерн.
 *
 * Порядок работы — от дешёвого к дорогому, как в эталоне: сперва проверки
 * существования по всем папкам, и только если ни одна не сошлась — поиск по
 * дереву. Возвращает ПЕРВЫЙ подошедший паттерн: расширение активируется один
 * раз, а остальные паттерны того же расширения уже ничего не решают.
 */
export async function matchWorkspaceContains(
    scanner: IWorkspaceScanner,
    folders: readonly string[],
    patterns: IWorkspaceContainsPatterns,
    options: IWorkspaceContainsSearchOptions = {},
): Promise<IWorkspaceContainsResult> {
    const token = options.token ?? CancellationTokenNone;
    for (const folder of folders) {
        for (const pattern of patterns.paths) {
            if (token.isCancellationRequested) return { pattern: null, truncated: true };
            if (await scanner.exists(path.join(folder, pattern))) return { pattern, truncated: false };
        }
    }
    if (patterns.globs.length === 0) return NO_MATCH;
    let truncated = false;
    for (const folder of folders) {
        const result = await searchGlobs(scanner, folder, patterns.globs, options);
        if (result.pattern !== null) return result;
        truncated = truncated || result.truncated;
    }
    return { pattern: null, truncated };
}

/**
 * Обход папки в ШИРИНУ до первого файла, подошедшего одному из glob'ов.
 *
 * В ширину, а не в глубину, потому что реальные паттерны мелкие
 * (`*\/pom.xml`, `*.py`): совпадение лежит у корня, и обход не обязан
 * спускаться в первую же попавшуюся ветку целиком.
 */
async function searchGlobs(
    scanner: IWorkspaceScanner,
    root: string,
    globs: readonly string[],
    options: IWorkspaceContainsSearchOptions,
): Promise<IWorkspaceContainsResult> {
    const excludes = options.excludeDirectories ?? DEFAULT_WORKSPACE_CONTAINS_EXCLUDES;
    const maxDirectories = options.maxDirectories ?? DEFAULT_MAX_DIRECTORIES;
    const token = options.token ?? CancellationTokenNone;
    const maxDepth = maxGlobDepth(globs);

    let frontier: { absolutePath: string; relativePath: string }[] = [{ absolutePath: root, relativePath: "" }];
    let read = 0;
    for (let depth = 0; depth <= maxDepth && frontier.length > 0; depth++) {
        const next: typeof frontier = [];
        for (const dir of frontier) {
            if (token.isCancellationRequested) return { pattern: null, truncated: true };
            if (read >= maxDirectories) return { pattern: null, truncated: true };
            read++;
            for (const entry of await scanner.readDirectory(dir.absolutePath)) {
                // Путь для матчинга — ОТНОСИТЕЛЬНЫЙ posix, от папки воркспейса:
                // ровно так якорится `matchGlob` (`*` не переходит `/`), и
                // ровно это имеет в виду `workspaceContains:*\/pom.xml`.
                const relativePath = dir.relativePath === "" ? entry.name : `${dir.relativePath}/${entry.name}`;
                if (entry.isDirectory) {
                    if (!excludes.has(entry.name)) {
                        next.push({ absolutePath: path.join(dir.absolutePath, entry.name), relativePath });
                    }
                    continue;
                }
                // Каталоги против glob'ов не матчим: событие про «есть ФАЙЛ по
                // паттерну». Каталог закрывается паттерном без glob-символов —
                // он уходит в `exists` и там истинен и для каталога.
                const hit = globs.find((glob) => matchGlob(glob, relativePath));
                if (hit !== undefined) return { pattern: hit, truncated: false };
            }
        }
        frontier = next;
    }
    return NO_MATCH;
}

/**
 * Глубина каталогов, глубже которой совпадения быть не может. Паттерн без `**`
 * фиксирует число сегментов пути, поэтому спускаться дальше незачем: `*.py`
 * читает только корень, `*\/pom.xml` — корень и первый уровень. `**` снимает
 * ограничение — там работает только бюджет каталогов.
 *
 * Оценка сверху: разбиение по `/` внутри `{a/b,c}` завышает число сегментов, но
 * лишний уровень обхода безопаснее пропущенного совпадения.
 */
function maxGlobDepth(globs: readonly string[]): number {
    let depth = 0;
    for (const glob of globs) {
        if (glob.includes("**")) return Number.POSITIVE_INFINITY;
        depth = Math.max(depth, glob.split("/").length - 1);
    }
    return depth;
}

/**
 * {@link IWorkspaceScanner} поверх настоящей ФС. Ошибки глотает по контракту
 * интерфейса: нет прав / каталог исчез по ходу обхода — это не повод сорвать
 * активацию.
 *
 * Симлинки на каталоги НЕ раскрываются (`Dirent.isDirectory()` у симлинка
 * ложный) — обход не зацикливается, а симлинк на файл остаётся кандидатом на
 * совпадение по имени.
 */
export function createNodeWorkspaceScanner(): IWorkspaceScanner {
    return {
        exists: async (absolutePath: string): Promise<boolean> => {
            try {
                await fs.promises.stat(absolutePath);
                return true;
            } catch {
                return false;
            }
        },
        readDirectory: async (absolutePath: string): Promise<readonly IWorkspaceDirectoryEntry[]> => {
            try {
                const entries = await fs.promises.readdir(absolutePath, { withFileTypes: true });
                return entries.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }));
            } catch {
                return [];
            }
        },
    };
}
