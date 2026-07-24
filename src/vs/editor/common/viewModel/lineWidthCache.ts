import { Disposable } from "../../../../../tuidom/common/disposable.ts";
import { measureTextWidth } from "../../../../../tuidom/common/measureTextWidth.ts";
import { STOP_RENDERING_LINE_AFTER } from "../../../../../tuidom/common/textLimits.ts";
import type { IDocumentContentChange } from "../model/iDocumentContentChange.ts";
import type { ITextDocument } from "../model/iTextDocument.ts";

/** Sentinel for "width of this line not computed yet / invalidated". */
const UNCOMPUTED = -1;

/**
 * Per-document cache of line display widths, used by the horizontal scrollbar
 * (`EditorElement.contentWidth`) to find the widest line.
 *
 * Replaces the old whole-document rescan (a `new DisplayLine` per line, keyed by
 * `versionId`, dropped on any edit). That rescan froze the editor on long lines
 * — worst of all in the Output panel, where every appended record bumps
 * `versionId` and re-segmented the whole document, one 200 k-char line included.
 *
 * Design mirrors {@link DocumentTokenStore}: an array parallel to the document
 * lines, kept in sync incrementally off {@link ITextDocument.onDidChangeContent}
 * (splice by `lineDelta`, invalidate only the changed lines). Width is measured
 * with {@link measureTextWidth} (no slot/`Int32Array` allocation) and **capped**
 * at {@link STOP_RENDERING_LINE_AFTER}, so one extreme line costs O(cap), and
 * appending a line recomputes only that line, not the document.
 */
export class LineWidthCache extends Disposable {
    private readonly document: ITextDocument;
    private tabSizeInternal: number;

    private lineWidths: number[] = [];
    /** `true` when a line width is uncomputed or the max may have changed. */
    private dirty = true;
    private maxWidth = 0;

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

    /**
     * Changing the tab size rescales every tab, so all cached widths are void.
     * No-op when the size is unchanged.
     */
    public setTabSize(tabSize: number): void {
        if (tabSize === this.tabSizeInternal) return;
        this.tabSizeInternal = tabSize;
        this.lineWidths.fill(UNCOMPUTED);
        this.dirty = true;
    }

    /**
     * Display width of the widest document line, in terminal columns.
     *
     * O(1) when nothing changed since the last call. After a content change it
     * is O(lineCount) in cheap number comparisons, and runs {@link measureTextWidth}
     * only for the lines actually invalidated.
     */
    public getMaxWidth(): number {
        const lineCount = this.document.lineCount;
        // A render is scheduled via setImmediate, so it can fire after the
        // document has shrunk (e.g. a revert, or teardown) while the width array
        // is still longer — a content change the cache never saw. The document is
        // the source of truth: on that desync, rebuild from scratch so we neither
        // read past it (mirrors DocumentTokenStore guarding by document.lineCount)
        // nor keep stale widths.
        if (this.lineWidths.length > lineCount) {
            this.lineWidths = new Array<number>(lineCount).fill(UNCOMPUTED);
            this.dirty = true;
        }

        if (!this.dirty) return this.maxWidth;

        let max = 0;
        for (let i = 0; i < lineCount; i++) {
            let w = this.lineWidths[i];
            if (w === UNCOMPUTED) {
                w = measureTextWidth(this.document.getLineContent(i), this.tabSizeInternal, STOP_RENDERING_LINE_AFTER);
                this.lineWidths[i] = w;
            }
            if (w > max) max = w;
        }

        this.maxWidth = max;
        this.dirty = false;
        return max;
    }

    private handleContentChange(change: IDocumentContentChange): void {
        const { startLine, oldEndLine, newEndLine } = change;
        const lineDelta = newEndLine - oldEndLine;

        if (lineDelta > 0) {
            // Insert `lineDelta` uncomputed slots after `oldEndLine`.
            const placeholders = new Array<number>(lineDelta).fill(UNCOMPUTED);
            this.lineWidths.splice(oldEndLine + 1, 0, ...placeholders);
        } else if (lineDelta < 0) {
            // Remove `-lineDelta` slots from the end of the changed region.
            this.lineWidths.splice(newEndLine + 1, -lineDelta);
        }

        // Invalidate every line now inside the changed region.
        for (let i = startLine; i <= newEndLine && i < this.lineWidths.length; i++) {
            this.lineWidths[i] = UNCOMPUTED;
        }

        // The max can move either way (a wide line removed/shrunk, a wide line
        // added), so force a recompute pass on the next query. That pass is
        // cheap number comparisons plus a re-measure of only the dirty lines.
        this.dirty = true;
    }
}
