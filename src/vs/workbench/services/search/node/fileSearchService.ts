import { spawn } from "node:child_process";
import * as path from "node:path";

import { Emitter } from "../../../../base/common/event.ts";
import { charMask, fuzzyMatchPreparedLower, prepareQuery } from "../../../../base/common/fuzzySearch.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import { GuardedChildProcess, splitLines } from "../../../../base/node/childProcessGuard.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import {
    FILES_EXCLUDE_SETTING,
    readUseIgnoreFiles,
    SEARCH_EXCLUDE_SETTING,
    SEARCH_IGNORE_FILES_SETTINGS,
    searchExcludeGlobs,
} from "../../../common/configuration/excludeSettings.ts";
import {
    BASENAME_BONUS,
    type FileSearchEntry,
    type FileSearchResult,
    type IFileSearchService,
} from "../common/fileSearch.ts";
import { buildRgFilesArgs } from "../common/ripgrepArgs.ts";

import { loadRipgrepPath } from "./loadRipgrep.ts";

const NOTIFY_DEBOUNCE_MS = 50;

const STALE_AFTER_MS = 10_000;

/**
 * No persistent recursive watcher — it starved the render and input loop; freshness comes
 * from `refreshIfStale()` when Quick Open opens, so a new file may show up with a delay.
 */
export class FileSearchService extends Disposable implements IFileSearchService {
    public static dependencies = [IConfigurationServiceDIToken] as const;

    private entries: FileSearchEntry[] = [];
    private rootPath: string | null = null;

    public isIndexed = false;

    private readonly onIndexChangedEmitter = new Emitter<void>();
    public readonly onIndexChanged = this.onIndexChangedEmitter.event;

    private isDisposedLocal = false;
    private walkGeneration = 0;
    private indexing = false;
    private lastIndexedAt = 0;
    private readyPromise: Promise<void> = Promise.resolve();
    private notifyTimer: ReturnType<typeof setTimeout> | null = null;
    private walker: GuardedChildProcess | null = null;
    private resolvedRgPath: string | null;

    /**
     * The index honors both `files.exclude` and `search.exclude` (`searchExcludeGlobs`); a
     * settings change rebuilds it at once — otherwise excluded files would linger until restart.
     */
    public constructor(
        private readonly configurationService: IConfigurationService,
        ripgrepPath?: string,
    ) {
        super();
        this.resolvedRgPath = ripgrepPath ?? null;
        const affecting = [FILES_EXCLUDE_SETTING, SEARCH_EXCLUDE_SETTING, ...SEARCH_IGNORE_FILES_SETTINGS];
        this.register(
            configurationService.onDidChangeConfiguration((event) => {
                if (!affecting.some((key) => event.affectsConfiguration(key))) return;
                if (this.isDisposedLocal) return;
                // Bypass the throttle: the index is stale by content, not by
                // time. `startIndexing` itself skips a window without a folder.
                this.lastIndexedAt = 0;
                this.readyPromise = this.startIndexing();
            }),
        );
    }

    public get ready(): Promise<void> {
        return this.readyPromise;
    }

    public activate(rootPath: string): Promise<void> {
        this.rootPath = rootPath;
        this.readyPromise = this.startIndexing();
        return this.readyPromise;
    }

    public refreshIfStale(): void {
        if (this.rootPath === null || this.isDisposedLocal) return;
        if (this.indexing) return;
        if (Date.now() - this.lastIndexedAt < STALE_AFTER_MS) return;
        this.readyPromise = this.startIndexing();
    }

    public search(query: string, maxResults = 50): FileSearchResult[] {
        // Prepared once per keystroke, never per index entry.
        const prepared = prepareQuery(query);
        if (prepared.terms.length === 0) {
            return this.entries.slice(0, maxResults).map((entry) => ({
                entry,
                score: 0,
                matchedIndices: [],
            }));
        }

        const results: FileSearchResult[] = [];
        // A fuzzy match needs every query char, and the path mask covers the basename too:
        // one integer AND rejects the entry for both match paths.
        const queryBits = prepared.bits;

        for (const entry of this.entries) {
            if ((entry.relativePathBits & queryBits) !== queryBits) continue;

            const basenameMatch =
                (entry.basenameBits & queryBits) === queryBits
                    ? fuzzyMatchPreparedLower(prepared, entry.basename, entry.basenameLower)
                    : null;
            if (basenameMatch !== null) {
                const offset = entry.relativePath.length - entry.basename.length;
                results.push({
                    entry,
                    score: basenameMatch.score + BASENAME_BONUS,
                    matchedIndices: basenameMatch.matchedIndices.map((i) => i + offset),
                });
                continue;
            }

            const pathMatch = fuzzyMatchPreparedLower(prepared, entry.relativePath, entry.relativePathLower);
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
        this.killWalker();
        if (this.notifyTimer !== null) {
            clearTimeout(this.notifyTimer);
            this.notifyTimer = null;
        }
        super.dispose();
    }

    private startIndexing(): Promise<void> {
        // A window without a folder gets here too (a `files.exclude` change), but there is nothing to walk.
        if (this.rootPath === null) return Promise.resolve();
        const root = this.rootPath;
        const generation = ++this.walkGeneration;
        this.killWalker();
        this.indexing = true;
        this.isIndexed = false;

        // Defer the walk so app.run()/the first render happen before it starts
        // consuming the event loop.
        return new Promise<void>((resolve) => setImmediate(resolve))
            .then(() => this.walk(root, generation))
            .catch(() => {
                /* rg failed to load (broken build asset) — the index stays empty, the editor keeps running */
            })
            .finally(() => {
                if (generation === this.walkGeneration) this.indexing = false;
            });
    }

    /**
     * `rg --files`, like upstream: rg honors ignore files and prunes excluded subtrees before
     * descending into them. Output is parsed as it arrives, so the index grows live.
     */
    private walk(root: string, generation: number): Promise<void> {
        if (this.cancelled(generation)) return Promise.resolve();
        const next: FileSearchEntry[] = [];
        // Initial build publishes `next` live; a refresh swaps at the end to avoid
        // flickering through a partial list.
        const live = this.entries.length === 0;
        if (live) this.entries = next;

        // Settings are read once per walk: changing them rebuilds the whole index anyway.
        const args = buildRgFilesArgs(
            searchExcludeGlobs(this.configurationService),
            readUseIgnoreFiles(this.configurationService),
        );
        const child = spawn(this.rgPath(), args, { cwd: root });
        // End on `close`: stdout may still hold lines after `exit`.
        // Stryker disable next-line StringLiteral: the service has no logger — the label never reaches a log
        const guard = new GuardedChildProcess(child, { label: "rg", waitForStdio: true });
        this.walker = guard;

        splitLines(child.stdout, (line) => {
            if (this.cancelled(generation)) return;
            const absPath = path.join(root, line);
            next.push(this.makeEntry(root, absPath, path.basename(absPath)));
            this.scheduleNotify();
        });

        return new Promise<void>((resolve) => {
            guard.onDidEnd(() => {
                // `walker` is not cleared: killing an exited process is harmless (see killWalker).
                // The exit code is ignored: 1 means "no files", 2 means rg hit an
                // unreadable directory but listed the rest; a missing root (spawn
                // `error`) yields an empty index, not a failure.
                if (!this.cancelled(generation)) {
                    // With live filling, `entries` already is `next`.
                    this.entries = next;
                    this.isIndexed = true;
                    this.lastIndexedAt = Date.now();
                    this.flushNotify();
                }
                resolve();
            });
        });
    }

    /**
     * `kill`, not the guard's `dispose`: dispose also silences `onDidEnd`, so `ready` would never settle.
     */
    private killWalker(): void {
        this.walker?.child.kill();
        this.walker = null;
    }

    private rgPath(): string {
        this.resolvedRgPath ??= loadRipgrepPath();
        return this.resolvedRgPath;
    }

    private cancelled(generation: number): boolean {
        return this.isDisposedLocal || generation !== this.walkGeneration;
    }

    private scheduleNotify(): void {
        if (this.notifyTimer !== null) return;
        this.notifyTimer = setTimeout(() => {
            this.notifyTimer = null;
            this.onIndexChangedEmitter.fire();
        }, NOTIFY_DEBOUNCE_MS);
    }

    private flushNotify(): void {
        if (this.notifyTimer !== null) {
            clearTimeout(this.notifyTimer);
            this.notifyTimer = null;
        }
        this.onIndexChangedEmitter.fire();
    }

    /** Case-folds up front so `search()` allocates no strings per keystroke. */
    private makeEntry(rootPath: string, absPath: string, basename: string): FileSearchEntry {
        const rel = path.relative(rootPath, absPath);
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
