import { measureTextWidth } from "@tuidom/core/common/measureTextWidth";

import { Disposable } from "../../../base/common/lifecycle.ts";
import type { IDocumentContentChange } from "../model/iDocumentContentChange.ts";
import type { ITextDocument } from "../model/iTextDocument.ts";

import { LONG_LINE_TRUNCATION_BADGE_WIDTH, STOP_RENDERING_LINE_AFTER } from "./longLineRendering.ts";

const UNCOMPUTED = -1;

/**
 * Incremental cache instead of rescanning the document on every edit: the rescan froze the
 * Output panel (every append bumps `versionId`) on a 200k-char line.
 * Width is capped at {@link STOP_RENDERING_LINE_AFTER}, so an extreme line costs O(cap).
 */
export class LineWidthCache extends Disposable {
    private readonly document: ITextDocument;
    private tabSizeInternal: number;

    private lineWidths: number[] = [];
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

    public setTabSize(tabSize: number): void {
        if (tabSize === this.tabSizeInternal) return;
        this.tabSizeInternal = tabSize;
        this.lineWidths.fill(UNCOMPUTED);
        this.dirty = true;
    }

    public getMaxWidth(): number {
        const lineCount = this.document.lineCount;
        // Render runs via setImmediate and may see the document already shortened (revert,
        // teardown) by an edit the cache never saw. The document is the source of truth: rebuild.
        if (this.lineWidths.length > lineCount) {
            this.lineWidths = new Array<number>(lineCount).fill(UNCOMPUTED);
            this.dirty = true;
        }

        if (!this.dirty) return this.maxWidth;

        let max = 0;
        for (let i = 0; i < lineCount; i++) {
            let w = this.lineWidths[i];
            if (w === UNCOMPUTED) {
                const content = this.document.getLineContent(i);
                w = measureTextWidth(content, this.tabSizeInternal, STOP_RENDERING_LINE_AFTER);
                // The "Long line trimmed" badge follows the truncated content; count it or horizontal scroll can't reach it.
                if (content.length > STOP_RENDERING_LINE_AFTER) w += LONG_LINE_TRUNCATION_BADGE_WIDTH;
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
            const placeholders = new Array<number>(lineDelta).fill(UNCOMPUTED);
            this.lineWidths.splice(oldEndLine + 1, 0, ...placeholders);
        } else if (lineDelta < 0) {
            this.lineWidths.splice(newEndLine + 1, -lineDelta);
        }

        for (let i = startLine; i <= newEndLine && i < this.lineWidths.length; i++) {
            this.lineWidths[i] = UNCOMPUTED;
        }

        this.dirty = true;
    }
}
