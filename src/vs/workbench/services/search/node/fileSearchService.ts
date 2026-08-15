import * as fs from "node:fs";
import * as path from "node:path";

import { Disposable } from "@tuidom/core/common/disposable";
import { charMask, fuzzyMatchBestLower } from "../../../../base/common/fuzzySearch.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";

export const FileSearchServiceDIToken = token<FileSearchService>("FileSearchService");

export const EXCLUDED_FS_NAMES = new Set(["node_modules", ".git", ".DS_Store"]);

/** Basename bonus so that a match in the filename beats a match only in the path. */
const BASENAME_BONUS = 200;

/** Debounce for onIndexChanged so a background walk does not spam subscribers. */
const NOTIFY_DEBOUNCE_MS = 50;

/** Skip an on-demand re-walk if the index was rebuilt more recently than this. */
const STALE_AFTER_MS = 10_000;

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
 * In-memory file index for Quick Open.
 *
 * The index is built **in the background**, yielding to the event loop between
 * directories so the editor stays responsive even on huge trees. There is no
 * always-on recursive filesystem watcher (it used to starve the render/input
 * loop); freshness is best-effort via `refreshIfStale()` (called when Quick Open
 * opens). A just-created file may therefore appear with a small delay.
 */
export class FileSearchService extends Disposable {
    public static dependencies = [] as const;

    private entries: FileSearchEntry[] = [];
    private rootPath: string | null = null;

    /** True once an initial background walk has fully completed. */
    public isIndexed = false;

    /** Fired (debounced) as the index grows or changes. */
    public onIndexChanged: (() => void) | null = null;

    private isDisposedLocal = false;
    /** Bumped on every walk; an in-flight walk bails when it sees a newer one. */
    private walkGeneration = 0;
    private indexing = false;
    private lastIndexedAt = 0;
    private readyPromise: Promise<void> = Promise.resolve();
    private notifyTimer: ReturnType<typeof setTimeout> | null = null;

    /** Resolves when the current (initial) background walk completes. */
    public get ready(): Promise<void> {
        return this.readyPromise;
    }

    /** Point the index at `rootPath` and start building it in the background. */
    public activate(rootPath: string): Promise<void> {
        this.rootPath = rootPath;
        this.readyPromise = this.startIndexing();
        return this.readyPromise;
    }

    /**
     * Rebuild the index in the background if it is stale and not already being
     * built. Cheap to call on every Quick Open; throttled internally.
     */
    public refreshIfStale(): void {
        if (this.rootPath === null || this.isDisposedLocal) return;
        if (this.indexing) return;
        if (Date.now() - this.lastIndexedAt < STALE_AFTER_MS) return;
        this.readyPromise = this.startIndexing();
    }

    /**
     * Search the index for files matching `query`. Works on a partial index
     * while a background walk is still in progress.
     *
     * - Empty query: returns first `maxResults` entries with score 0.
     * - Non-empty query: tries fuzzy match on the basename first (with bonus),
     *   falls back to matching the full relative path. Sorted by score desc.
     */
    public search(query: string, maxResults = 50): FileSearchResult[] {
        if (query === "") {
            return this.entries.slice(0, maxResults).map((entry) => ({
                entry,
                score: 0,
                matchedIndices: [],
            }));
        }

        const results: FileSearchResult[] = [];
        // Lowercase the query once; entries carry pre-lowercased strings so the
        // hot loop allocates no case-folded strings per keystroke.
        const queryLower = query.toLowerCase();
        // Char-presence mask of the query, computed once. A fuzzy match needs
        // every query char present in the text, so an entry whose path lacks any
        // of them cannot match at all — reject it with one integer AND before
        // touching the matcher. The path mask covers the basename too (the path
        // contains it), so it is the necessary condition for either match path.
        const queryBits = charMask(queryLower);

        for (const entry of this.entries) {
            // Cheap reject: path lacks some query char → neither basename nor
            // path can match. Skips the expensive matcher for most entries.
            if ((entry.relativePathBits & queryBits) !== queryBits) continue;

            // First try matching against the basename only, but only when the
            // basename itself could contain every query char.
            const basenameMatch =
                (entry.basenameBits & queryBits) === queryBits
                    ? fuzzyMatchBestLower(queryLower, entry.basename, entry.basenameLower)
                    : null;
            if (basenameMatch !== null) {
                // Re-map indices from basename space to relativePath space
                const offset = entry.relativePath.length - entry.basename.length;
                results.push({
                    entry,
                    score: basenameMatch.score + BASENAME_BONUS,
                    matchedIndices: basenameMatch.matchedIndices.map((i) => i + offset),
                });
                continue;
            }

            // Fall back to matching against the full relative path
            const pathMatch = fuzzyMatchBestLower(queryLower, entry.relativePath, entry.relativePathLower);
            if (pathMatch !== null) {
                results.push({
                    entry,
                    score: pathMatch.score,
                    matchedIndices: pathMatch.matchedIndices,
                });
            }
        }

        results.sort((a, b) => b.score - a.score);
        return results.slice(0, maxResults);
    }

    public override dispose(): void {
        this.isDisposedLocal = true;
        if (this.notifyTimer !== null) {
            clearTimeout(this.notifyTimer);
            this.notifyTimer = null;
        }
        super.dispose();
    }

    // ─── Private: background indexing ─────────────────────────────────────────

    private startIndexing(): Promise<void> {
        /* v8 ignore start -- defensive: callers (activate/refreshIfStale) only invoke this with a non-null rootPath */
        if (this.rootPath === null) return Promise.resolve();
        /* v8 ignore stop */
        const root = this.rootPath;
        const generation = ++this.walkGeneration;
        this.indexing = true;
        this.isIndexed = false;

        // Defer the first batch so app.run()/the first render happen before the
        // walk starts consuming the event loop.
        return new Promise<void>((resolve) => {
            setImmediate(() => {
                void this.walk(root, generation).finally(() => {
                    if (generation === this.walkGeneration) this.indexing = false;
                    resolve();
                });
            });
        });
    }

    private async walk(root: string, generation: number): Promise<void> {
        const next: FileSearchEntry[] = [];
        // When the index is empty (initial build) publish `next` immediately so
        // results grow live. On a refresh keep the old list and swap at the end
        // to avoid flicker through a partial/empty state.
        const live = this.entries.length === 0;
        if (live) this.entries = next;

        const stack: string[] = [root];
        for (let dir = stack.pop(); dir !== undefined; dir = stack.pop()) {
            if (this.cancelled(generation)) return;

            let dirents: fs.Dirent[];
            try {
                dirents = await fs.promises.readdir(dir, { withFileTypes: true });
            } catch {
                continue;
            }

            for (const dirent of dirents) {
                if (EXCLUDED_FS_NAMES.has(dirent.name)) continue;
                const absPath = path.join(dir, dirent.name);
                if (dirent.isDirectory()) {
                    stack.push(absPath);
                } else if (dirent.isFile()) {
                    next.push(this.makeEntry(root, absPath, dirent.name));
                }
            }

            this.scheduleNotify();
            // Yield to the event loop after each directory.
            await new Promise<void>((resolve) => setImmediate(resolve));
        }

        /* v8 ignore start -- race guard: reaching this requires disposal/regeneration during the last directory's setImmediate yield; not deterministically reachable in a unit test */
        if (this.cancelled(generation)) return;
        /* v8 ignore stop */
        if (!live) this.entries = next;
        this.isIndexed = true;
        this.lastIndexedAt = Date.now();
        this.flushNotify();
    }

    private cancelled(generation: number): boolean {
        return this.isDisposedLocal || generation !== this.walkGeneration;
    }

    private scheduleNotify(): void {
        if (this.notifyTimer !== null) return;
        this.notifyTimer = setTimeout(() => {
            this.notifyTimer = null;
            this.onIndexChanged?.();
        }, NOTIFY_DEBOUNCE_MS);
    }

    private flushNotify(): void {
        if (this.notifyTimer !== null) {
            clearTimeout(this.notifyTimer);
            this.notifyTimer = null;
        }
        this.onIndexChanged?.();
    }

    /**
     * Builds a {@link FileSearchEntry}, pre-computing the case-folded basename and
     * relative path so `search()` does zero string allocation per keystroke.
     */
    private makeEntry(rootPath: string, absPath: string, basename: string): FileSearchEntry {
        const rel = path.relative(rootPath, absPath);
        // Normalise to forward slashes on all platforms
        const relativePath = rel.split(path.sep).join("/");
        const basenameLower = basename.toLowerCase();
        const relativePathLower = relativePath.toLowerCase();
        return {
            relativePath,
            absolutePath: absPath,
            basename,
            basenameLower,
            relativePathLower,
            basenameBits: charMask(basenameLower),
            relativePathBits: charMask(relativePathLower),
        };
    }
}
