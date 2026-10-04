import { spawn } from "node:child_process";

import { Disposable } from "../../../../base/common/lifecycle.ts";
import { GuardedChildProcess, splitLines } from "../../../../base/node/childProcessGuard.ts";
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
    private readonly children = new Set<GuardedChildProcess>();
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
            return {
                complete: Promise.resolve(empty()),
                cancel: () => {
                    /* отменять нечего — запрос не запускался */
                },
            };
        }

        const child = spawn(this.rgPath(), args, { cwd: folder });
        // Конец — по `close`: результаты разбираются из stdout, и после `exit` в
        // нём ещё могут оставаться строки.
        // Stryker disable next-line StringLiteral: логгера у сервиса нет — метка в лог не попадает
        const guard = new GuardedChildProcess(child, { label: "rg", waitForStdio: true });
        this.children.add(guard);

        let matchCount = 0;
        const files = new Set<string>();
        let limitHit = false;
        let cancelled = false;
        let stderr = "";

        const cancel = (): void => {
            if (cancelled) return;
            cancelled = true;
            child.kill();
        };

        splitLines(child.stdout, (line) => {
            if (cancelled) return;
            const fileMatch = parseRgMatchLine(line);
            if (fileMatch === null) return;
            files.add(fileMatch.absolutePath);
            matchCount += fileMatch.matches.length;
            onResult(fileMatch);
            if (matchCount >= MAX_RESULTS) {
                limitHit = true;
                cancel();
            }
        });

        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk: string) => {
            stderr += chunk;
        });

        const complete = new Promise<ITextSearchComplete>((resolve) => {
            guard.onDidEnd((end) => {
                this.children.delete(guard);
                // Spawn-level failure (e.g. rg binary missing) — no stdout/close.
                // rg exit codes: 0 = matches, 1 = no matches, 2 = error (writes stderr).
                const error =
                    end.error !== undefined
                        ? (end.error as Error).message
                        : !cancelled && end.code === 2
                          ? stderr.trim()
                          : undefined;
                resolve({ matchCount, fileCount: files.size, limitHit, error });
            });
        });

        return { complete, cancel };
    }

    public override dispose(): void {
        // kill, а не dispose guard'а: `complete` поиска должен дорешиться и после снятия.
        for (const guard of this.children) guard.child.kill();
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
