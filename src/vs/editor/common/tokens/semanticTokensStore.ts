import { Emitter } from "../../../base/common/event.ts";
import { Disposable } from "../../../base/common/lifecycle.ts";
import type { ITextDocument } from "../model/iTextDocument.ts";

import { type ISemanticLineTokens, SemanticTokensLines } from "./semanticTokensLines.ts";

/**
 * Второй слой токенов документа — семантические токены поверх TextMate
 * (семантическая половина `TokenizationTextModelPart` эталона и его
 * `SparseTokensStore`). Полный набор от провайдера документа ({@link set})
 * заменяет всё; токены видимой области от range-провайдера
 * ({@link setPartial}) кладутся, только пока полного набора нет. Правки
 * документа сдвигают токены до прихода свежего ответа.
 *
 * Один на документ (модель), общий для всех его вью.
 */
export class SemanticTokensStore extends Disposable {
    private lines = new SemanticTokensLines();
    private complete = false;
    private readonly onDidChangeEmitter = this.register(new Emitter<void>());
    /** Токены сменились (ответ провайдера, очистка) — пора перерисовать. */
    public readonly onDidChange = this.onDidChangeEmitter.event;

    public constructor(document: ITextDocument) {
        super();
        this.register(
            document.onDidChangeModelContent((event) => {
                if (event.isFlush) {
                    this.lines = new SemanticTokensLines();
                    return;
                }
                for (const change of event.changes) this.lines.applyEdit(change.range, change.text);
            }),
        );
    }

    /** Есть полный набор от провайдера документа: range-провайдер не нужен. */
    public hasCompleteSemanticTokens(): boolean {
        return this.complete;
    }

    /** Есть хоть один токен (полный набор или видимая область). */
    public hasSomeSemanticTokens(): boolean {
        return this.lines.lineNumbers.length > 0;
    }

    public getLineTokens(line: number): ISemanticLineTokens | undefined {
        return this.lines.getLine(line);
    }

    /**
     * Полный набор (`null` — токенов нет). `isComplete` — ответ провайдера
     * документа, даже пустой: range-провайдер после него не зовётся.
     */
    public set(lines: SemanticTokensLines | null, isComplete: boolean): void {
        this.lines = lines ?? new SemanticTokensLines();
        this.complete = isComplete;
        this.onDidChangeEmitter.fire();
    }

    /** Токены строк `startLine..endLine` (range-провайдер); при полном наборе — игнор. */
    public setPartial(startLine: number, endLine: number, lines: SemanticTokensLines): void {
        if (this.complete) return;
        this.lines.replaceLines(startLine, endLine, lines);
        this.onDidChangeEmitter.fire();
    }
}
