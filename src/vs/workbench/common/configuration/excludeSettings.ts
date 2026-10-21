import { matchAnyGlob } from "../../../base/common/glob.ts";

/**
 * Three settings answer three different questions, as upstream:
 * - `files.exclude` — "this doesn't exist": tree, file index, search, `findFiles`;
 * - `search.exclude` — "keep out of search", on top of `files.exclude`. The entry stays
 *   in the tree: people read dependency sources, but in search results they are noise;
 * - `files.watcherExclude` — "don't watch", its own inotify budget; not used by search or the tree.
 *
 * The value is a `{ "<glob>": true }` map: configuration layers merge by key, so an
 * unwanted default is turned off with `false` instead of being removed from a copy of a list.
 */

export const FILES_EXCLUDE_SETTING = "files.exclude";

export const SEARCH_EXCLUDE_SETTING = "search.exclude";

export const WATCHER_EXCLUDE_SETTING = "files.watcherExclude";

/**
 * Both `IConfigurationService` and the extension host's `WorkspaceConfigStore` fit structurally,
 * so the same code builds the patterns on both sides of the wire.
 */
export interface IExcludeConfigReader {
    get(key: string): unknown;
}

/** Not a map → empty set: a broken setting means "no exclusions", not a failure in the consumer. */
export function parseExcludeSetting(value: unknown): string[] {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
    return Object.entries(value as Record<string, unknown>)
        .filter(([, enabled]) => enabled === true)
        .map(([pattern]) => pattern);
}

export function filesExcludeGlobs(config: IExcludeConfigReader): string[] {
    return parseExcludeSetting(config.get(FILES_EXCLUDE_SETTING));
}

/** `search.exclude` adds to `files.exclude` rather than replacing it, as upstream. */
export function searchExcludeGlobs(config: IExcludeConfigReader): string[] {
    return [...filesExcludeGlobs(config), ...parseExcludeSetting(config.get(SEARCH_EXCLUDE_SETTING))];
}

export function watcherExcludeGlobs(config: IExcludeConfigReader): string[] {
    return parseExcludeSetting(config.get(WATCHER_EXCLUDE_SETTING));
}

/**
 * `relativePath` is posix and relative to the workspace root: that is how patterns are anchored and how
 * the watcher and ripgrep match them. `""` is the root itself, which is never excluded.
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
 * Same shape as upstream's `folderOpt.useIgnoreFiles` (`ripgrepTextSearchEngine.ts`). `parent` and
 * `global` mean nothing without `local`.
 */
export interface IUseIgnoreFiles {
    readonly local: boolean;
    readonly parent: boolean;
    readonly global: boolean;
}

/** Upstream defaults hold for a broken value too: only an explicit `false` disables `local`, only `true` enables the rest. */
export function readUseIgnoreFiles(config: IExcludeConfigReader): IUseIgnoreFiles {
    return {
        local: config.get(SEARCH_USE_IGNORE_FILES_SETTING) !== false,
        parent: config.get(SEARCH_USE_PARENT_IGNORE_FILES_SETTING) === true,
        global: config.get(SEARCH_USE_GLOBAL_IGNORE_FILES_SETTING) === true,
    };
}
