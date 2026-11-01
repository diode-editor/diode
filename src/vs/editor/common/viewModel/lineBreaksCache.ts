import { Disposable } from "../../../base/common/lifecycle.ts";
import type { IDocumentContentChange } from "../model/iDocumentContentChange.ts";
import type { ITextDocument } from "../model/iTextDocument.ts";

import { computeLineBreakOffsets } from "./lineBreaksComputer.ts";
import { type LineInsertions, NO_LINE_INSERTIONS } from "./lineInsertions.ts";

/**
 * Without the cache every projection rebuild would re-segment the whole document. Per-line value:
 * `null` means not wrapped, `undefined` means not computed yet.
 */
export class LineBreaksCache extends Disposable {
    private readonly document: ITextDocument;
    private tabSize: number;
    private wrapWidth: number;

    private breaks: (number[] | null | undefined)[];
    private insertions: LineInsertions = NO_LINE_INSERTIONS;

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

    /** Drops only the lines whose insertions differ; `false` means no line does, the breaks are all still valid. */
    public setInsertions(insertions: LineInsertions): boolean {
        const previous = this.insertions;
        this.insertions = insertions;
        let changed = false;
        for (const line of new Set([...previous.keys(), ...insertions.keys()])) {
            const before = previous.get(line);
            const after = insertions.get(line);
            const same =
                before !== undefined &&
                before.length === after?.length &&
                before.every((b, i) => b.offset === after[i].offset && b.text === after[i].text);
            if (same) continue;
            changed = true;
            this.breaks[line] = undefined;
        }
        return changed;
    }

    /** Desync guard, same as {@link LineWidthCache.getMaxWidth}. */
    public getBreaks(line: number): number[] | null {
        if (this.breaks.length > this.document.lineCount) {
            this.breaks = new Array<number[] | null | undefined>(this.document.lineCount);
        }
        let entry = this.breaks[line];
        if (entry === undefined) {
            entry = computeLineBreakOffsets(
                this.document.getLineContent(line),
                this.tabSize,
                this.wrapWidth,
                this.insertions.get(line),
            );
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
