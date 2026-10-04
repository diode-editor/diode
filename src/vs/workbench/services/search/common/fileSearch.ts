import type { Event } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";

/**
 * Basename bonus so that a match in the filename beats a match only in the path.
 * Exported so the open-editors picker ranks its own (tiny, index-free) list the
 * same way the file picker ranks the index — one ranking, one constant.
 */
export const BASENAME_BONUS = 200;

export interface FileSearchEntry {
    relativePath: string;
    absolutePath: string;
    /** Basename in original case — used for word-boundary scoring and labels. */
    basename: string;
    /** Pre-lowercased basename, for allocation-free matching on the hot path. */
    basenameLower: string;
    /** Pre-lowercased relative path, for the path-fallback match. */
    relativePathLower: string;
    /** Char-presence mask of `basenameLower`, to skip the basename match. */
    basenameBits: number;
    /** Char-presence mask of `relativePathLower`; the global match prefilter. */
    relativePathBits: number;
}

export interface FileSearchResult {
    entry: FileSearchEntry;
    score: number;
    matchedIndices: readonly number[];
}

/**
 * Порт файлового индекса Quick Open (как `ISearchService.fileSearch` у VS Code):
 * потребителям в `browser/` нужен только он, реализация с обходом диска живёт в
 * `services/search/node/fileSearchService.ts`.
 */
export interface IFileSearchService extends IDisposable {
    /** Индекс построен хотя бы раз. */
    readonly isIndexed: boolean;
    /** Индекс изменился (с дебаунсом фонового обхода). */
    readonly onIndexChanged: Event<void>;
    /** Завершение начальной сборки индекса текущего корня. */
    readonly ready: Promise<void>;
    /** Начать (пере)индексацию корня в фоне. */
    activate(rootPath: string): Promise<void>;
    /** Переобойти дерево, если индекс устарел (зовёт Quick Open при открытии). */
    refreshIfStale(): void;
    search(query: string, maxResults?: number): FileSearchResult[];
}

export const FileSearchServiceDIToken = token<IFileSearchService>("FileSearchService");
