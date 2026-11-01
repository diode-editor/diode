import { Disposable } from "../../../base/common/lifecycle.ts";
import type { IDocumentContentChange } from "../model/iDocumentContentChange.ts";
import type { IInlineInsertion } from "../model/iInlineInsertion.ts";
import type { ITextDocument } from "../model/iTextDocument.ts";

import { computeComposedLineBreakOffsets, computeLineBreakOffsets } from "./lineBreaksComputer.ts";
import { type LineInsertions, NO_LINE_INSERTIONS } from "./lineInsertions.ts";

/**
 * Without the cache every projection rebuild would re-segment the whole document. Per-line value:
 * `null` means not wrapped, `undefined` means not computed yet.
 */
export class LineBreaksCache extends Disposable {
    private readonly document: ITextDocument;
    private tabSize: number;
    private wrapWidth: number;
    private insertions: LineInsertions = NO_LINE_INSERTIONS;

    private breaks: (number[] | null | undefined)[];

    public constructor(document: ITextDocument, tabSize: number, wrapWidth: number) {
        super();
        this.document = document;
        this.tabSize = tabSize;
        this.wrapWidth = wrapWidth;
        this.breaks = new Array<number[] | null | undefined>(document.lineCount);
        this.register(
            document.onDidChangeContent((change) => {
                this.handleContentChange(change);
            }),
        );
    }

    /** No-op for the same params: called on every projection rebuild. */
    public setParams(tabSize: number, wrapWidth: number): void {
        if (tabSize === this.tabSize && wrapWidth === this.wrapWidth) return;
        this.tabSize = tabSize;
        this.wrapWidth = wrapWidth;
        this.breaks = new Array<number[] | null | undefined>(this.document.lineCount);
    }

    /** `true` when some line wraps by other text now: the rows built from this cache are stale. */
    public setInsertions(insertions: LineInsertions): boolean {
        let changed = false;
        for (const line of new Set([...this.insertions.keys(), ...insertions.keys()])) {
            if (sameCells(this.insertions.get(line), insertions.get(line))) continue;
            this.breaks[line] = undefined;
            changed = true;
        }
        this.insertions = insertions;
        return changed;
    }

    /** Desync guard, same as {@link LineWidthCache.getMaxWidth}. */
    public getBreaks(line: number): number[] | null {
        if (this.breaks.length > this.document.lineCount) {
            this.breaks = new Array<number[] | null | undefined>(this.document.lineCount);
        }
        let entry = this.breaks[line];
        if (entry === undefined) {
            const content = this.document.getLineContent(line);
            const insertions = this.insertions.get(line);
            entry =
                insertions === undefined
                    ? computeLineBreakOffsets(content, this.tabSize, this.wrapWidth)
                    : computeComposedLineBreakOffsets(content, insertions, this.tabSize, this.wrapWidth);
            this.breaks[line] = entry;
        }
        return entry;
    }

    private handleContentChange(change: IDocumentContentChange): void {
        const { startLine, oldEndLine, newEndLine } = change;
        const lineDelta = newEndLine - oldEndLine;

        // One splice for any delta sign: branching would leave the zero case dead.
        const placeholders = new Array<undefined>(Math.max(0, lineDelta));
        this.breaks.splice(Math.min(oldEndLine, newEndLine) + 1, Math.max(0, -lineDelta), ...placeholders);

        // Stryker disable next-line ArithmeticOperator: the length clamp guards against desync (a cache shorter than the document only happens after a lost event); in a synced cache min always picks newEndLine
        const lastInvalidated = Math.min(newEndLine, this.breaks.length - 1);
        for (let i = startLine; i <= lastInvalidated; i++) {
            this.breaks[i] = undefined;
        }
    }
}

/** Looks do not wrap: a recolored hint keeps its rows. Lines come from either map, so at most one side is absent. */
function sameCells(a: readonly IInlineInsertion[] | undefined, b: readonly IInlineInsertion[] | undefined): boolean {
    if (a === undefined || b === undefined) return false;
    return a.length === b.length && a.every((item, i) => item.offset === b[i].offset && item.text === b[i].text);
}
