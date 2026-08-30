import { Disposable } from "@tuidom/core/common/disposable";
import type { IDocumentContentChange } from "../model/iDocumentContentChange.ts";
import type { ITextDocument } from "../model/iTextDocument.ts";

import { computeLineBreakOffsets } from "./lineBreaksComputer.ts";

/**
 * Пер-документный кеш break-offsets переноса строк — структурный близнец
 * {@link LineWidthCache}: массив параллельно строкам документа, инкрементальная
 * синхронизация со splice по `lineDelta` из {@link ITextDocument.onDidChangeContent}
 * и ленивый пересчёт только инвалидированных строк. Без кеша каждый rebuild
 * проекции (любая правка) пересегментировал бы ВЕСЬ документ, а не изменённые
 * строки.
 *
 * Значение по строке: `number[]` — offsets начал фрагментов, `null` — строка
 * влезает и не переносится, `undefined` — ещё не посчитано/инвалидировано.
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

    /**
     * Смена tabSize или ширины переноса двигает каждую точку разрыва — весь кеш
     * недействителен. No-op при тех же параметрах: зовётся на каждый rebuild
     * проекции.
     */
    public setParams(tabSize: number, wrapWidth: number): void {
        if (tabSize === this.tabSize && wrapWidth === this.wrapWidth) return;
        this.tabSize = tabSize;
        this.wrapWidth = wrapWidth;
        this.breaks = new Array<number[] | null | undefined>(this.document.lineCount);
    }

    /**
     * Break-offsets строки (`null` — не переносится); считает лениво по
     * требованию. Гард рассинхрона — как у {@link LineWidthCache.getMaxWidth}:
     * рендер планируется через setImmediate и может прийти после сжатия
     * документа, которого кеш не видел, — документ и есть источник правды.
     */
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

        if (lineDelta > 0) {
            // Insert `lineDelta` uncomputed slots after `oldEndLine`.
            const placeholders = new Array<undefined>(lineDelta).fill(undefined);
            this.breaks.splice(oldEndLine + 1, 0, ...placeholders);
        } else if (lineDelta < 0) {
            // Remove `-lineDelta` slots from the end of the changed region.
            this.breaks.splice(newEndLine + 1, -lineDelta);
        }

        // Invalidate every line now inside the changed region.
        for (let i = startLine; i <= newEndLine && i < this.breaks.length; i++) {
            this.breaks[i] = undefined;
        }
    }
}
