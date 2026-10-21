import { matchAnyGlob } from "../../../base/common/glob.ts";

/**
 * Три настройки — три разных вопроса, как в эталоне:
 * - `files.exclude` — «этого нет»: дерево, индекс файлов, поиск, `findFiles`;
 * - `search.exclude` — «не надо в поиске», добавка к `files.exclude`. В дереве вход
 *   остаётся: исходник зависимости читают, а в результатах поиска он шум;
 * - `files.watcherExclude` — «не следим», свой бюджет inotify; в поиске и дереве не участвует.
 *
 * Значение — карта `{ "<glob>": true }`: слои конфигурации сливаются по ключам, и
 * ненужный дефолт гасится `false`, а не вычёркиванием из копии списка.
 */

export const FILES_EXCLUDE_SETTING = "files.exclude";

export const SEARCH_EXCLUDE_SETTING = "search.exclude";

export const WATCHER_EXCLUDE_SETTING = "files.watcherExclude";

/**
 * Структурно подходят и `IConfigurationService`, и `WorkspaceConfigStore` субпроцесса
 * расширений: шаблоны по обе стороны провода собираются одним кодом.
 */
export interface IExcludeConfigReader {
    get(key: string): unknown;
}

/** Не карта — пустой набор: битая настройка значит «исключений нет», а не отказ потребителя. */
export function parseExcludeSetting(value: unknown): string[] {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
    return Object.entries(value as Record<string, unknown>)
        .filter(([, enabled]) => enabled === true)
        .map(([pattern]) => pattern);
}

export function filesExcludeGlobs(config: IExcludeConfigReader): string[] {
    return parseExcludeSetting(config.get(FILES_EXCLUDE_SETTING));
}

/** `search.exclude` не заменяет `files.exclude`, а дополняет — как у эталона. */
export function searchExcludeGlobs(config: IExcludeConfigReader): string[] {
    return [...filesExcludeGlobs(config), ...parseExcludeSetting(config.get(SEARCH_EXCLUDE_SETTING))];
}

export function watcherExcludeGlobs(config: IExcludeConfigReader): string[] {
    return parseExcludeSetting(config.get(WATCHER_EXCLUDE_SETTING));
}

/**
 * `relativePath` — относительно корня воркспейса, posix: так якорятся шаблоны и так же
 * их матчат watcher и ripgrep. `""` — сам корень, он не исключается никогда.
 */
export function isExcludedPath(relativePath: string, globs: readonly string[]): boolean {
    if (relativePath === "") return false;
    return matchAnyGlob(globs, relativePath);
}

export const SEARCH_USE_IGNORE_FILES_SETTING = "search.useIgnoreFiles";

export const SEARCH_USE_PARENT_IGNORE_FILES_SETTING = "search.useParentIgnoreFiles";

export const SEARCH_USE_GLOBAL_IGNORE_FILES_SETTING = "search.useGlobalIgnoreFiles";

export const SEARCH_IGNORE_FILES_SETTINGS = [
    SEARCH_USE_IGNORE_FILES_SETTING,
    SEARCH_USE_PARENT_IGNORE_FILES_SETTING,
    SEARCH_USE_GLOBAL_IGNORE_FILES_SETTING,
] as const;

/**
 * Форма `folderOpt.useIgnoreFiles` эталона (`ripgrepTextSearchEngine.ts`). `parent` и
 * `global` без `local` не значат ничего.
 */
export interface IUseIgnoreFiles {
    readonly local: boolean;
    readonly parent: boolean;
    readonly global: boolean;
}

/** Дефолты эталона действуют и при битом значении: `local` гасит только явный `false`, остальные включает только `true`. */
export function readUseIgnoreFiles(config: IExcludeConfigReader): IUseIgnoreFiles {
    return {
        local: config.get(SEARCH_USE_IGNORE_FILES_SETTING) !== false,
        parent: config.get(SEARCH_USE_PARENT_IGNORE_FILES_SETTING) === true,
        global: config.get(SEARCH_USE_GLOBAL_IGNORE_FILES_SETTING) === true,
    };
}
