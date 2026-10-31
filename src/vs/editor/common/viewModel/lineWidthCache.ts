import { measureTextWidth } from "@tuidom/core/common/measureTextWidth";

import { spliceInChunks } from "../../../base/common/arrays.ts";
import { Disposable } from "../../../base/common/lifecycle.ts";
import type { IDocumentContentChange } from "../model/iDocumentContentChange.ts";
import type { ITextDocument } from "../model/iTextDocument.ts";

import { LONG_LINE_TRUNCATION_BADGE_WIDTH, STOP_RENDERING_LINE_AFTER } from "./longLineRendering.ts";

const UNCOMPUTED = -1;

/**
 * Display widths of the document's lines, measured on demand: the viewport's lines when a frame
 * asks ({@link measureLines}), the rest in slices off the frame path ({@link measurePending}).
 * Upstream `ViewLines._maxLineWidth` knows only the lines it has rendered; a 200k-line file
 * measured up front held the first frame for seconds.
 *
 * The width ({@link getMaxWidth}) is the maximum over the measured lines: a lower bound of the
 * document's width that grows as lines get measured. An edit re-measures only the touched lines;
 * the maximum is rescanned (numbers, no measuring) only when a line that held it goes away.
 * Width is capped at {@link STOP_RENDERING_LINE_AFTER}, so an extreme line costs O(cap).
 */
export class LineWidthCache extends Disposable {
    private readonly document: ITextDocument;
    private tabSizeInternal: number;

    private lineWidths: number[] = [];
    private maxWidth = 0;
    /**
     * A measured line of width {@link maxWidth} was invalidated or removed: the maximum may be
     * lower. Only a saving: rescanning when nothing went away finds the same maximum, so the
     * mutants that rescan more often are equivalent and disabled below.
     */
    // Stryker disable next-line BooleanLiteral: see above
    private maxStale = false;
    /** Every line before it is measured until an edit moves it back: where {@link measurePending} resumes. */
    private sweepLine = 0;

    public constructor(document: ITextDocument, tabSize: number) {
        super();
        this.document = document;
        this.tabSizeInternal = tabSize;

        this.lineWidths = new Array<number>(document.lineCount).fill(UNCOMPUTED);

        this.register(
            document.onDidChangeContent((change) => {
                this.handleContentChange(change);
            }),
        );
    }

    public setTabSize(tabSize: number): void {
        if (tabSize === this.tabSizeInternal) return;
        this.tabSizeInternal = tabSize;
        this.reset();
    }

    /** The maximum over the measured lines so far. */
    public getMaxWidth(): number {
        this.syncLineCount();
        // Stryker disable next-line ConditionalExpression: rescanning more often, see maxStale
        if (this.maxStale) {
            // Unmeasured lines are -1 and lose to 0.
            let max = 0;
            for (const width of this.lineWidths) {
                // Stryker disable next-line EqualityOperator: a tie is the same maximum
                if (width > max) max = width;
            }
            this.maxWidth = max;
            // Stryker disable next-line BooleanLiteral: rescanning more often, see maxStale
            this.maxStale = false;
        }
        return this.maxWidth;
    }

    /** Whether {@link measurePending} has lines left. */
    public get hasUnmeasuredLines(): boolean {
        this.syncLineCount();
        return this.nextUnmeasured() !== -1;
    }

    /** Measures these lines now (the viewport): the frame's width includes what it shows. */
    public measureLines(lines: readonly number[]): void {
        this.syncLineCount();
        for (const line of lines) {
            if (this.lineWidths[line] === UNCOMPUTED) this.measure(line);
        }
    }

    /**
     * Measures up to `maxLines` unmeasured lines, top to bottom. Returns whether lines remain:
     * the caller slices the work between frames and input.
     */
    public measurePending(maxLines: number): boolean {
        this.syncLineCount();
        let line = this.nextUnmeasured();
        let budget = maxLines;
        while (line !== -1 && budget > 0) {
            this.measure(line);
            budget--;
            line = this.nextUnmeasured();
        }
        return line !== -1;
    }

    private measure(line: number): void {
        const content = this.document.getLineContent(line);
        let width = measureTextWidth(content, this.tabSizeInternal, STOP_RENDERING_LINE_AFTER);
        // The "Long line trimmed" badge follows the truncated content; count it or horizontal scroll can't reach it.
        if (content.length > STOP_RENDERING_LINE_AFTER) width += LONG_LINE_TRUNCATION_BADGE_WIDTH;
        this.lineWidths[line] = width;
        // A measured line at or above the old maximum is the maximum, stale or not.
        // Stryker disable next-line EqualityOperator: rescanning more often, see maxStale
        if (width >= this.maxWidth) {
            this.maxWidth = width;
            // Stryker disable next-line BooleanLiteral: rescanning more often, see maxStale
            this.maxStale = false;
        }
    }

    /** The first unmeasured line from {@link sweepLine} on, which moves up to it (or past the end). */
    private nextUnmeasured(): number {
        const line = this.lineWidths.indexOf(UNCOMPUTED, this.sweepLine);
        this.sweepLine = line === -1 ? this.lineWidths.length : line;
        return line;
    }

    /**
     * Render runs via setImmediate and may see the document already changed (revert, teardown)
     * by an edit the cache never saw. The document is the source of truth: rebuild.
     */
    private syncLineCount(): void {
        if (this.lineWidths.length !== this.document.lineCount) this.reset();
    }

    private reset(): void {
        this.lineWidths = new Array<number>(this.document.lineCount).fill(UNCOMPUTED);
        this.maxWidth = 0;
        // Stryker disable next-line BooleanLiteral: rescanning more often, see maxStale
        this.maxStale = false;
        this.sweepLine = 0;
    }

    private handleContentChange(change: IDocumentContentChange): void {
        const { startLine, oldEndLine, newEndLine } = change;
        const lineDelta = newEndLine - oldEndLine;

        if (lineDelta > 0) {
            const placeholders = new Array<number>(lineDelta).fill(UNCOMPUTED);
            spliceInChunks(this.lineWidths, oldEndLine + 1, 0, placeholders);
        } else if (lineDelta < 0) {
            for (const width of this.lineWidths.splice(newEndLine + 1, -lineDelta)) this.forget(width);
        }

        for (let i = startLine; i <= newEndLine && i < this.lineWidths.length; i++) {
            this.forget(this.lineWidths[i]);
            this.lineWidths[i] = UNCOMPUTED;
        }

        this.sweepLine = Math.min(this.sweepLine, startLine);
    }

    /** A width leaves the set: the maximum has to be found again if this was it. */
    private forget(width: number): void {
        // Stryker disable next-line ConditionalExpression: rescanning more often, see maxStale
        if (width === this.maxWidth) this.maxStale = true;
    }
}
