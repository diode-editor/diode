import { Emitter } from "../../../base/common/event.ts";
import { Disposable } from "../../../base/common/lifecycle.ts";
import type { ITextDocument } from "../model/iTextDocument.ts";

import { type ISemanticLineTokens, SemanticTokensLines } from "./semanticTokensLines.ts";

/** The semantic half of upstream `TokenizationTextModelPart`; one per document, shared by views. */
export class SemanticTokensStore extends Disposable {
    private lines = new SemanticTokensLines();
    private complete = false;
    private readonly onDidChangeEmitter = this.register(new Emitter<void>());
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

    public hasCompleteSemanticTokens(): boolean {
        return this.complete;
    }

    public hasSomeSemanticTokens(): boolean {
        return this.lines.lineNumbers.length > 0;
    }

    public getLineTokens(line: number): ISemanticLineTokens | undefined {
        return this.lines.getLine(line);
    }

    /** `isComplete` marks a document provider answer, even an empty one: the range provider is not called after it. */
    public set(lines: SemanticTokensLines | null, isComplete: boolean): void {
        this.lines = lines ?? new SemanticTokensLines();
        this.complete = isComplete;
        this.onDidChangeEmitter.fire();
    }

    public setPartial(startLine: number, endLine: number, lines: SemanticTokensLines): void {
        if (this.complete) return;
        this.lines.replaceLines(startLine, endLine, lines);
        this.onDidChangeEmitter.fire();
    }
}
