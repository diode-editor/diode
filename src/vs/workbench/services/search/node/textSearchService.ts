import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";

import { Disposable } from "../../../../../../tuidom/common/disposable.ts";
import {
    buildRgArgs,
    type IFileMatch,
    type ISearchHandle,
    type ITextSearchComplete,
    type ITextSearchQuery,
    type ITextSearchService,
    parseRgMatchLine,
} from "../common/textSearch.ts";

import { loadRipgrepPath } from "./loadRipgrep.ts";

/** Cap on total matches per search — a huge result set is killed early (VS Code caps too). */
const MAX_RESULTS = 10000;

/**
 * Content search across the workspace, backed by ripgrep. Spawns `rg --json`,
 * streams parsed per-line results to `onResult` as they arrive, and reports a
 * summary when done. Each call is an independent process — the UI cancels the
 * previous {@link ISearchHandle} before starting the next (debounced) query.
 */
export class TextSearchService extends Disposable implements ITextSearchService {
    public static dependencies = [] as const;

    /** Live child processes, killed on dispose so a search never outlives the app. */
    private readonly children = new Set<ChildProcessWithoutNullStreams>();
    private resolvedRgPath: string | null;

    /**
     * @param ripgrepPath Explicit `rg` path (tests). Omitted in production, where
     * it is resolved lazily via {@link loadRipgrepPath} (dev node_modules / SEA asset).
     */
    public constructor(ripgrepPath?: string) {
        super();
        this.resolvedRgPath = ripgrepPath ?? null;
    }

    /**
     * Runs {@link query} under `folder`, streaming each file's matches to
     * `onResult`. Returns immediately with a handle; awaiting `handle.complete`
     * yields the summary. An empty/invalid query completes with zero results.
     */
    public search(query: ITextSearchQuery, folder: string, onResult: (match: IFileMatch) => void): ISearchHandle {
        const args = buildRgArgs(query, folder);
        if (args === null) {
            return { complete: Promise.resolve(empty()), cancel: () => {} };
        }

        const child = spawn(this.rgPath(), args, { cwd: folder });
        this.children.add(child);

        let matchCount = 0;
        const files = new Set<string>();
        let limitHit = false;
        let cancelled = false;
        let stdoutBuf = "";
        let stderr = "";

        const cancel = (): void => {
            if (cancelled) return;
            cancelled = true;
            child.kill();
        };

        const complete = new Promise<ITextSearchComplete>((resolve) => {
            const finish = (error?: string): void => {
                this.children.delete(child);
                resolve({ matchCount, fileCount: files.size, limitHit, error });
            };

            child.stdout.setEncoding("utf8");
            child.stdout.on("data", (chunk: string) => {
                if (cancelled) return;
                stdoutBuf += chunk;
                let nl = stdoutBuf.indexOf("\n");
                while (nl !== -1) {
                    const line = stdoutBuf.slice(0, nl);
                    stdoutBuf = stdoutBuf.slice(nl + 1);
                    const fileMatch = parseRgMatchLine(line);
                    if (fileMatch !== null) {
                        files.add(fileMatch.absolutePath);
                        matchCount += fileMatch.matches.length;
                        onResult(fileMatch);
                        if (matchCount >= MAX_RESULTS) {
                            limitHit = true;
                            cancel();
                            return;
                        }
                    }
                    nl = stdoutBuf.indexOf("\n");
                }
            });

            child.stderr.setEncoding("utf8");
            child.stderr.on("data", (chunk: string) => {
                stderr += chunk;
            });

            // Spawn-level failure (e.g. rg binary missing) — no stdout/close.
            child.on("error", (err) => finish(err.message));
            // rg exit codes: 0 = matches, 1 = no matches, 2 = error (writes stderr).
            child.on("close", (code) => {
                finish(!cancelled && code === 2 ? stderr.trim() : undefined);
            });
        });

        return { complete, cancel };
    }

    public override dispose(): void {
        for (const child of this.children) child.kill();
        this.children.clear();
        super.dispose();
    }

    private rgPath(): string {
        this.resolvedRgPath ??= loadRipgrepPath();
        return this.resolvedRgPath;
    }
}

function empty(): ITextSearchComplete {
    return { matchCount: 0, fileCount: 0, limitHit: false };
}
