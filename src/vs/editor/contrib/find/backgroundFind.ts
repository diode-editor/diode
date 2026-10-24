import type { IDisposable } from "../../../base/common/lifecycle.ts";
import { setTimeout0 } from "../../../base/common/platform.ts";
import type { IRange } from "../../common/core/iRange.ts";
import type { ITextDocument } from "../../common/model/iTextDocument.ts";

import {
    appendLineMatches,
    type IPreparedQuery,
    type ITextMatchOptions,
    MATCHES_LIMIT,
    prepareQuery,
} from "./findMatches.ts";

/** Lines of one slice; a slice also ends early at {@link BACKGROUND_FIND_SLICE_CHARS}. */
export const BACKGROUND_FIND_SLICE_LINES = 4096;
/** A minified file has lines of a megabyte: the slice is bounded by characters too. */
export const BACKGROUND_FIND_SLICE_CHARS = 512 * 1024;
/** Progress is reported at the first match, then at most this often, and at the end. */
export const BACKGROUND_FIND_REPORT_INTERVAL_MS = 100;

export interface IBackgroundFindProgress {
    /** Sorted by position, at most {@link MATCHES_LIMIT}; a new array on every report. */
    readonly matches: IRange[];
    /** The walk is over: the whole document was seen, or the collection stopped at the limit. */
    readonly done: boolean;
    /**
     * The lines from the start line to the end were all seen: a match after the cursor can no longer turn up
     * (unless the document grows), so the first match of the list is the one to reveal when none is after it.
     */
    readonly wrapped: boolean;
}

/**
 * A document whose lines are still arriving (the index of a document on disk is built in the background,
 * docs/arch/Editor.md): the search waits at the end for more lines instead of finishing.
 */
export interface IGrowingDocument {
    isGrowing(): boolean;
    /** Fires when lines were appended or the growth is over. */
    onDidGrow(listener: () => void): IDisposable;
}

export interface IBackgroundFindOptions {
    /** The line the walk starts at (the cursor): the first match found is the nearest after it. */
    readonly startLine: number;
    readonly growth?: IGrowingDocument | null;
    /** Between slices; tests step by hand. */
    readonly schedule?: (slice: () => void) => void;
    readonly sliceLines?: number;
    readonly sliceChars?: number;
    readonly reportIntervalMs?: number;
}

/**
 * The find over a document on disk (OpenPerformance 4.3): the lines are walked in slices between frames and
 * keys, the matches found so far are reported as the walk goes, and the collection stops at
 * {@link MATCHES_LIMIT} as upstream's does. No upstream analog: `findModel.ts` walks the whole model at once,
 * which blocks for seconds on a 500 MB file and for a minute on 2 GB.
 *
 * The walk starts at the cursor's line and wraps around to the top, so the first match reported is the one
 * the find reveals; the reported list is always in document order.
 */
export class BackgroundFind implements IDisposable {
    private readonly query: IPreparedQuery;
    private readonly growth: IGrowingDocument | null;
    private readonly schedule: (slice: () => void) => void;
    private readonly sliceLines: number;
    private readonly sliceChars: number;
    private readonly reportIntervalMs: number;
    /** Where the walk started; the lines before it are walked last. */
    private readonly startLine: number;
    /** The next line of the pass from the start line to the end (and on, as the document grows). */
    private afterLine: number;
    /** The next line of the pass from the top to the start line. */
    private beforeLine = 0;
    /** Matches of the two passes: `before` all precede `after` in the document. */
    private readonly before: IRange[] = [];
    private readonly after: IRange[] = [];
    private doneValue = false;
    private disposed = false;
    private reportedTotal = -1;
    private lastReportAt = 0;
    private growthSubscription: IDisposable | null = null;

    public constructor(
        private readonly document: ITextDocument,
        query: string,
        options: ITextMatchOptions,
        private readonly onProgress: (progress: IBackgroundFindProgress) => void,
        findOptions: IBackgroundFindOptions,
    ) {
        this.query = prepareQuery(query, options);
        this.growth = findOptions.growth ?? null;
        this.schedule = findOptions.schedule ?? setTimeout0;
        this.sliceLines = findOptions.sliceLines ?? BACKGROUND_FIND_SLICE_LINES;
        this.sliceChars = findOptions.sliceChars ?? BACKGROUND_FIND_SLICE_CHARS;
        this.reportIntervalMs = findOptions.reportIntervalMs ?? BACKGROUND_FIND_REPORT_INTERVAL_MS;
        this.startLine = Math.max(0, Math.min(findOptions.startLine, document.lineCount - 1));
        this.afterLine = this.startLine;
        if (this.query.length === 0) this.doneValue = true;
    }

    public get done(): boolean {
        return this.doneValue;
    }

    /** The first slice runs right away: a dense query has its first matches before the first frame. */
    public start(): void {
        if (this.doneValue) {
            this.report();
            return;
        }
        this.runSlice();
    }

    public dispose(): void {
        this.disposed = true;
        this.growthSubscription?.dispose();
        this.growthSubscription = null;
    }

    private runSlice(): void {
        if (this.disposed || this.doneValue) return;
        const lineCount = this.document.lineCount;
        const inAfterPass = this.afterLine < lineCount;
        const from = inAfterPass ? this.afterLine : this.beforeLine;
        const to = Math.min(inAfterPass ? lineCount : this.startLine, from + this.sliceLines);
        // The slice is a walk over a prepared list, not a counter a mutant could stall (docs/MUTATION.md).
        const lines = Array.from({ length: Math.max(0, to - from) }, (_, index) => from + index);
        const out = inAfterPass ? this.after : this.before;
        let chars = 0;
        for (const line of lines) {
            const content = this.document.getLineContent(line);
            if (inAfterPass) this.afterLine = line + 1;
            else this.beforeLine = line + 1;
            if (!appendLineMatches(line, content, this.query, out, MATCHES_LIMIT - (this.total() - out.length))) {
                this.doneValue = true;
                break;
            }
            chars += content.length;
            if (chars >= this.sliceChars) break;
        }
        let pausing = false;
        if (!this.doneValue && this.afterLine >= this.document.lineCount && this.beforeLine >= this.startLine) {
            if (this.growth?.isGrowing() === true) {
                this.waitForGrowth();
                pausing = true;
            } else {
                this.doneValue = true;
            }
        }
        // A pause for the index may last seconds: what was found so far goes out even inside the interval.
        this.report(pausing);
        if (!this.doneValue && this.growthSubscription === null) {
            this.schedule(() => {
                this.runSlice();
            });
        }
    }

    private total(): number {
        return this.before.length + this.after.length;
    }

    /** The end of what is indexed so far: the next slice runs when more lines are in (or the growth is over). */
    private waitForGrowth(): void {
        /* v8 ignore start -- runSlice is not re-entered while a subscription is live: a slice is scheduled only without one */
        // Stryker disable next-line ConditionalExpression,LogicalOperator,EqualityOperator: unreachable for the same reason as for coverage; the null check is for the type
        if (this.growthSubscription !== null || this.growth === null) return;
        /* v8 ignore stop */
        this.growthSubscription = this.growth.onDidGrow(() => {
            // Stryker disable next-line OptionalChaining: the field is assigned right after the subscription; the chain covers an event that fires inside it
            this.growthSubscription?.dispose();
            this.growthSubscription = null;
            this.runSlice();
        });
    }

    private report(force = false): void {
        const total = this.total();
        if (!this.doneValue && !force) {
            if (total === this.reportedTotal) return;
            // The first match goes out at once (it is what the find reveals); after it the counter is throttled.
            if (this.reportedTotal > 0 && Date.now() - this.lastReportAt < this.reportIntervalMs) return;
        }
        this.reportedTotal = total;
        this.lastReportAt = Date.now();
        this.onProgress({
            matches: this.before.concat(this.after),
            done: this.doneValue,
            wrapped: this.doneValue || this.afterLine >= this.document.lineCount,
        });
    }
}
