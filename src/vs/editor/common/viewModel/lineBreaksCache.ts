import { Disposable } from "../../../base/common/lifecycle.ts";
import type { IDocumentContentChange } from "../model/iDocumentContentChange.ts";
import type { ITextDocument } from "../model/iTextDocument.ts";

import { computeLineBreakOffsets } from "./lineBreaksComputer.ts";

/**
 * Без кеша каждый rebuild проекции пересегментировал бы весь документ. Значение по строке:
 * `null` — не переносится, `undefined` — не посчитано.
 */
export class LineBreaksCache extends Disposable {
    private readonly document: ITextDocument;
    private tabSize: number;
    private wrapWidth: number;

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

    /** No-op при тех же параметрах: зовётся на каждый rebuild проекции. */
    public setParams(tabSize: number, wrapWidth: number): void {
        if (tabSize === this.tabSize && wrapWidth === this.wrapWidth) return;
        this.tabSize = tabSize;
        this.wrapWidth = wrapWidth;
        this.breaks = new Array<number[] | null | undefined>(this.document.lineCount);
    }

    /** Гард рассинхрона — как у {@link LineWidthCache.getMaxWidth}. */
    public getBreaks(line: number): number[] | null {
        if (this.breaks.length > this.document.lineCount) {
            this.breaks = new Array<number[] | null | undefined>(this.document.lineCount);
        }
        let entry = this.breaks[line];
        if (entry === undefined) {
            entry = computeLineBreakOffsets(this.document.getLineContent(line), this.tabSize, this.wrapWidth);
            this.breaks[line] = entry;
        }
        return entry;
    }

    private handleContentChange(change: IDocumentContentChange): void {
        const { startLine, oldEndLine, newEndLine } = change;
        const lineDelta = newEndLine - oldEndLine;

        // Один splice на любой знак дельты: ветвление оставило бы нулевой случай мёртвым.
        const placeholders = new Array<undefined>(Math.max(0, lineDelta));
        this.breaks.splice(Math.min(oldEndLine, newEndLine) + 1, Math.max(0, -lineDelta), ...placeholders);

        // Stryker disable next-line ArithmeticOperator: кламп по длине — защитный на рассинхрон (кеш короче документа возможен только при уже потерянном событии); в синхронном кеше min всегда выбирает newEndLine
        const lastInvalidated = Math.min(newEndLine, this.breaks.length - 1);
        for (let i = startLine; i <= lastInvalidated; i++) {
            this.breaks[i] = undefined;
        }
    }
}
