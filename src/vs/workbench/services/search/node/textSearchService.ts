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

const MAX_RESULTS = 10000;

/** Each call is its own `rg` process; the caller cancels the previous handle. */
export class TextSearchService extends Disposable implements ITextSearchService {
    public static dependencies = [] as const;

    private readonly children = new Set<GuardedChildProcess>();
    private resolvedRgPath: string | null;

    public constructor(ripgrepPath?: string) {
        super();
        this.resolvedRgPath = ripgrepPath ?? null;
    }

    /** An empty or invalid query completes with zero results. */
    public search(query: ITextSearchQuery, folder: string, onResult: (match: IFileMatch) => void): ISearchHandle {
        const args = buildRgArgs(query, folder);
        if (args === null) {
            return {
                complete: Promise.resolve(empty()),
                cancel: () => {
                    /* nothing to cancel — the query never started */
                },
            };
        }

        const child = spawn(this.rgPath(), args, { cwd: folder });
        // End on `close`: stdout may still hold lines after `exit`.
        // Stryker disable next-line StringLiteral: the service has no logger — the label never reaches a log
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

        // Stryker disable next-line StringLiteral,CallExpression: an empty encoding is utf8 in Node, and without it `+=` converts the Buffer to a utf8 string anyway
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk: string) => {
            stderr += chunk;
        });

        const complete = new Promise<ITextSearchComplete>((resolve) => {
            guard.onDidEnd((end) => {
                // Stryker disable next-line CallExpression: without the delete, dispose would merely "kill" an already exited rg — killing a dead process is harmless
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
        // kill, not the guard's dispose: the search's `complete` must still settle after disposal.
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
