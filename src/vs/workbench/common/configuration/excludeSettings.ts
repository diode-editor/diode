import { matchAnyGlob } from "../../../base/common/glob.ts";

/**
 * Слой exclude-настроек: ключи, разбор значения и сборка набора шаблонов для
 * каждого потребителя.
 *
 * Настроек три, и это ТРИ РАЗНЫХ вопроса — ровно как в эталоне:
 *
 * - `files.exclude` — «этого нет»: вход скрыт из дерева Explorer'а, не попадает
 *   в индекс файлов (Quick Open), не находится поиском и не виден
 *   `workspace.findFiles` расширения;
 * - `search.exclude` — «этого не надо В ПОИСКЕ»: добавляется к `files.exclude`
 *   только для поиска (по именам файлов и по содержимому). В дереве вход
 *   остаётся — `node_modules` у эталона скрыт ровно так, и это осознанно:
 *   исходник зависимости читают, а в результатах поиска он шум;
 * - `files.watcherExclude` — «за этим не следим»: отдельный набор со своим
 *   бюджетом (inotify-watch'и), см. `filesConfiguration.ts`. В поиске и дереве
 *   он не участвует, поэтому в сборках ниже его нет.
 *
 * Форма значения — карта `{ "<glob>": true }`, как у эталона: слои
 * конфигурации сливаются ПО КЛЮЧАМ, поэтому свой шаблон добавляется рядом с
 * дефолтными, а ненужный дефолт гасится значением `false` (а не вычёркиванием
 * из копии всего списка). Объектные значения настроек при этом не сплющиваются
 * по точкам — см. `normalizeNode` в `configurationModel.ts`.
 */

/** Ключ настройки «этого нет»: дерево, индекс файлов, поиск, `findFiles`. */
export const FILES_EXCLUDE_SETTING = "files.exclude";

/** Ключ настройки «этого не надо в поиске»: добавка к `files.exclude`. */
export const SEARCH_EXCLUDE_SETTING = "search.exclude";

/** Ключ настройки «за этим не следим» (свой набор, см. шапку модуля). */
export const WATCHER_EXCLUDE_SETTING = "files.watcherExclude";

/**
 * Чтение одного ключа настроек — всё, что сборкам ниже нужно от конфигурации.
 * Структурно соответствуют и `IConfigurationService` (главный процесс), и
 * `WorkspaceConfigStore` (снапшот на стороне субпроцесса расширений): шаблоны
 * одинаковы по обе стороны провода, и собираются они одним кодом.
 */
export interface IExcludeConfigReader {
    get(key: string): unknown;
}

/**
 * Разбирает значение exclude-настройки в список активных шаблонов. Значение
 * `false` временно выключает шаблон, не удаляя его из настроек; всё, что не
 * карта, даёт пустой набор (битую настройку трактуем как «исключений нет», а не
 * как отказ потребителя).
 */
export function parseExcludeSetting(value: unknown): string[] {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
    return Object.entries(value as Record<string, unknown>)
        .filter(([, enabled]) => enabled === true)
        .map(([pattern]) => pattern);
}

/** Шаблоны `files.exclude`: что скрыто везде. */
export function filesExcludeGlobs(config: IExcludeConfigReader): string[] {
    return parseExcludeSetting(config.get(FILES_EXCLUDE_SETTING));
}

/**
 * Шаблоны поиска: `files.exclude` ПЛЮС `search.exclude`. Так же их складывает
 * эталон — `search.exclude` не заменяет первый набор, а дополняет его.
 */
export function searchExcludeGlobs(config: IExcludeConfigReader): string[] {
    return [...filesExcludeGlobs(config), ...parseExcludeSetting(config.get(SEARCH_EXCLUDE_SETTING))];
}

/** Шаблоны `files.watcherExclude`: за чем не следим. */
export function watcherExcludeGlobs(config: IExcludeConfigReader): string[] {
    return parseExcludeSetting(config.get(WATCHER_EXCLUDE_SETTING));
}

/**
 * Матчит вход против набора шаблонов.
 *
 * `relativePath` — путь входа ОТНОСИТЕЛЬНО корня воркспейса в posix-форме:
 * ровно так якорятся шаблоны (`**\/x` матчит и `x`, и `a/b/x`, а `x` — только
 * вход в корне), ровно так же их матчит watcher (`isExcluded` в
 * `chokidarTreeWatcher.ts`) и ripgrep (`--glob !<pattern>`). Относительный путь
 * считает вызывающий — только он знает, из чего.
 *
 * Пустая строка — сам корень; он не исключается никогда, иначе дерево и обход
 * не стартовали бы вовсе.
 */
export function isExcludedPath(relativePath: string, globs: readonly string[]): boolean {
    if (relativePath === "") return false;
    return matchAnyGlob(globs, relativePath);
}

/** Ключ: уважать ли `.gitignore`/`.ignore` в поиске (по именам и по содержимому). */
export const SEARCH_USE_IGNORE_FILES_SETTING = "search.useIgnoreFiles";

/** Ключ: уважать ли ignore-файлы РОДИТЕЛЬСКИХ каталогов корня. */
export const SEARCH_USE_PARENT_IGNORE_FILES_SETTING = "search.useParentIgnoreFiles";

/** Ключ: уважать ли глобальный gitignore (`core.excludesFile`). */
export const SEARCH_USE_GLOBAL_IGNORE_FILES_SETTING = "search.useGlobalIgnoreFiles";

/** Все ключи ignore-файлов: правка любого из них меняет набор файлов поиска. */
export const SEARCH_IGNORE_FILES_SETTINGS = [
    SEARCH_USE_IGNORE_FILES_SETTING,
    SEARCH_USE_PARENT_IGNORE_FILES_SETTING,
    SEARCH_USE_GLOBAL_IGNORE_FILES_SETTING,
] as const;

/**
 * Какие ignore-файлы уважает поиск — форма `useIgnoreFiles` эталона
 * (`folderOptions.useIgnoreFiles` в `ripgrepTextSearchEngine.ts`). `parent` и
 * `global` без `local` не значат ничего: «Requires search.useIgnoreFiles».
 */
export interface IUseIgnoreFiles {
    readonly local: boolean;
    readonly parent: boolean;
    readonly global: boolean;
}

/**
 * Читает три настройки ignore-файлов. Дефолты — эталона, и они же действуют
 * при отсутствующем или битом значении: `local` выключает только явный
 * `false`, `parent`/`global` включает только явный `true`.
 */
export function readUseIgnoreFiles(config: IExcludeConfigReader): IUseIgnoreFiles {
    return {
        local: config.get(SEARCH_USE_IGNORE_FILES_SETTING) !== false,
        parent: config.get(SEARCH_USE_PARENT_IGNORE_FILES_SETTING) === true,
        global: config.get(SEARCH_USE_GLOBAL_IGNORE_FILES_SETTING) === true,
    };
}
