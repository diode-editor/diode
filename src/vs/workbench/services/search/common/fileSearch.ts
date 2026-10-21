import type { Event } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";

/** A match in the basename beats a match only in the path. */
export const BASENAME_BONUS = 200;

export interface FileSearchEntry {
    relativePath: string;
    absolutePath: string;
    basename: string;
    basenameLower: string;
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

export interface IFileSearchService extends IDisposable {
    readonly isIndexed: boolean;
    readonly onIndexChanged: Event<void>;
    readonly ready: Promise<void>;
    activate(rootPath: string): Promise<void>;
    refreshIfStale(): void;
    search(query: string, maxResults?: number): FileSearchResult[];
}

export const FileSearchServiceDIToken = token<IFileSearchService>("FileSearchService");
