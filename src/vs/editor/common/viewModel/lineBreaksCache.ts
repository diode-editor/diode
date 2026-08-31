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

        // Один splice на любой сдвиг: рост вставляет `lineDelta` невычисленных
        // слотов после oldEndLine, сжатие удаляет `-lineDelta` после newEndLine
        // (min покрывает оба конца); нулевая дельта вырождается в no-op сама —
        // без ветвления, у которого нулевой случай был бы мёртвым.
        const placeholders = new Array<undefined>(Math.max(0, lineDelta));
        this.breaks.splice(Math.min(oldEndLine, newEndLine) + 1, Math.max(0, -lineDelta), ...placeholders);

        // Invalidate every line now inside the changed region.
        // Stryker disable next-line ArithmeticOperator: кламп по длине — защитный на рассинхрон (кеш короче документа возможен только при уже потерянном событии); в синхронном кеше min всегда выбирает newEndLine
        const lastInvalidated = Math.min(newEndLine, this.breaks.length - 1);
        for (let i = startLine; i <= lastInvalidated; i++) {
            this.breaks[i] = undefined;
        }
    }
}
