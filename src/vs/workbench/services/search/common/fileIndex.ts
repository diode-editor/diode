import { charMask, fuzzyMatchPreparedLower, prepareQuery } from "../../../../base/common/fuzzySearch.ts";

import { BASENAME_BONUS, type IRawFileMatch, MAX_INDEXED_FILES } from "./fileSearch.ts";

/**
 * Case-folded up front so a query allocates no strings per entry. Most paths are lower case already,
 * and for them V8's `toLowerCase` returns the same string: the copy costs nothing (measured).
 */
interface IndexEntry {
    readonly relativePath: string;
    readonly basename: string;
    readonly relativePathLower: string;
    readonly basenameLower: string;
    /** Char-presence mask of the lower-case path; the global match prefilter. */
    readonly relativePathBits: number;
    /** Char-presence mask of the lower-case basename, to skip the basename match. */
    readonly basenameBits: number;
}

/** Posix relative paths of one folder, fuzzy-searchable. Holds at most `capacity` entries. */
export class FileIndex {
    private readonly entries: IndexEntry[] = [];

    public constructor(private readonly capacity = MAX_INDEXED_FILES) {}

    public get size(): number {
        return this.entries.length;
    }

    public get isFull(): boolean {
        return this.entries.length >= this.capacity;
    }

    /** `false` when the index is full and the path was dropped. */
    public add(relativePath: string): boolean {
        if (this.isFull) return false;
        const basename = relativePath.slice(relativePath.lastIndexOf("/") + 1);
        const pathLower = relativePath.toLowerCase();
        const basenameLower = basename.toLowerCase();
        this.entries.push({
            relativePath,
            basename,
            relativePathLower: pathLower,
            basenameLower,
            relativePathBits: charMask(pathLower),
            basenameBits: charMask(basenameLower),
        });
        return true;
    }

    public search(query: string, maxResults: number): IRawFileMatch[] {
        // Prepared once per keystroke, never per index entry.
        const prepared = prepareQuery(query);
        if (prepared.terms.length === 0) {
            return this.entries
                .slice(0, maxResults)
                .map((entry) => ({ relativePath: entry.relativePath, score: 0, matchedIndices: [] }));
        }

        const results: IRawFileMatch[] = [];
        // A fuzzy match needs every query char, and the path mask covers the basename too:
        // one integer AND rejects the entry for both match paths.
        const queryBits = prepared.bits;

        for (const entry of this.entries) {
            // Stryker disable next-line ConditionalExpression: a speed-only prefilter, it never drops a match ("bitmask prefilter does not change results"); the `fileSearchEngine` bench tells the mutant apart
            if ((entry.relativePathBits & queryBits) !== queryBits) continue;

            const basenameMatch =
                // Stryker disable next-line ConditionalExpression: a speed-only prefilter, as above — the matcher itself answers null
                (entry.basenameBits & queryBits) === queryBits
                    ? fuzzyMatchPreparedLower(prepared, entry.basename, entry.basenameLower)
                    : null;
            if (basenameMatch !== null) {
                const offset = entry.relativePath.length - entry.basename.length;
                results.push({
                    relativePath: entry.relativePath,
                    score: basenameMatch.score + BASENAME_BONUS,
                    matchedIndices: basenameMatch.matchedIndices.map((i) => i + offset),
                });
                continue;
            }

            const pathMatch = fuzzyMatchPreparedLower(prepared, entry.relativePath, entry.relativePathLower);
            if (pathMatch !== null) {
                results.push({
                    relativePath: entry.relativePath,
                    score: pathMatch.score,
                    matchedIndices: pathMatch.matchedIndices,
                });
            }
        }

        results.sort((a, b) => b.score - a.score);
        return results.slice(0, maxResults);
    }
}
