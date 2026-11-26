import type { Event } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IUseIgnoreFiles } from "../../../common/configuration/excludeSettings.ts";

/** A match in the basename beats a match only in the path. */
export const BASENAME_BONUS = 200;

/**
 * Safety cap of one file index. A deviation: upstream has none and holds every path, which on a home
 * directory of 14.5M files ran a process out of heap (#1179). Measured on long home-directory paths: 1M
 * entries hold ~490 MB of heap (two at once while a new walk replaces the old one) and a query takes 2-3 s;
 * 500k halves both, and a 316k-file monorepo still fits with room to spare.
 */
export const MAX_INDEXED_FILES = 500_000;

/** What to walk; the cache key names the index, like upstream's `IFileQuery.cacheKey`. */
export interface IFileIndexRequest {
    readonly cacheKey: string;
    readonly folder: string;
    /** `files.exclude` + `search.exclude` globs (`searchExcludeGlobs`). */
    readonly excludes: readonly string[];
    readonly useIgnoreFiles: IUseIgnoreFiles;
}

export interface IFileIndexResult {
    /** The walk stopped at {@link MAX_INDEXED_FILES}: some files are missing from the index. */
    readonly limitHit: boolean;
}

export interface IFileQueryRequest {
    readonly cacheKey: string;
    readonly query: string;
    readonly maxResults: number;
}

/** Posix path relative to the indexed folder; indices point into it. */
export interface IRawFileMatch {
    readonly relativePath: string;
    readonly score: number;
    readonly matchedIndices: readonly number[];
}

export interface IFileQueryResult {
    readonly matches: readonly IRawFileMatch[];
    /** `false` while the walk is running and for an unknown cache key (cleared, or the host restarted). */
    readonly complete: boolean;
    readonly limitHit: boolean;
}

/**
 * The index and the fuzzy match live behind this port, outside the editor process: upstream runs
 * them in the extension host (`ExtHostSearch.$enableExtensionHostSearch`), and so do we.
 * Every method may reject (the host is down); the caller survives that.
 */
export interface IFileSearchProvider {
    /** Starts the walk for the key (a second call joins it); settles when the walk ends. */
    index(request: IFileIndexRequest): Promise<IFileIndexResult>;
    /** Answers from what is indexed so far: the index grows live. */
    query(request: IFileQueryRequest): Promise<IFileQueryResult>;
    /** Stops the walk and frees the index. */
    clearCache(cacheKey: string): void;
    /** The index under the key grew or completed; debounced by the provider. */
    readonly onDidChangeIndex: Event<string>;
}

export interface FileSearchResult {
    readonly relativePath: string;
    readonly absolutePath: string;
    readonly basename: string;
    readonly score: number;
    /** Into {@link relativePath}. */
    readonly matchedIndices: readonly number[];
}

export interface IFileSearchResults {
    readonly results: readonly FileSearchResult[];
    readonly limitHit: boolean;
    /** No more results will come for this query: the answering index is complete (or nothing can answer). */
    readonly complete: boolean;
}

/**
 * One showing of a picker, like upstream `FileQueryCacheState`: opening it starts a fresh walk; until
 * the walk completes, queries are answered from the previous completed index of the same folder.
 */
export interface IFileSearchSession extends IDisposable {
    /** The results for the same query may have changed: the index grew or completed. */
    readonly onDidChange: Event<void>;
    /** Settles when this session's walk ends (or failed); never rejects. */
    readonly ready: Promise<void>;
    /** Never rejects: a failed provider gives no results. */
    search(query: string, maxResults: number): Promise<IFileSearchResults>;
}

export interface IFileSearchService extends IDisposable {
    createSession(): IFileSearchSession;
    /** Without a provider every search is empty. The last registered wins. */
    registerProvider(provider: IFileSearchProvider): IDisposable;
}

export const FileSearchServiceDIToken = token<IFileSearchService>("FileSearchService");
