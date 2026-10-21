import type { Event } from "../../../base/common/event.ts";
import { Emitter } from "../../../base/common/event.ts";
import { Disposable } from "../../../base/common/lifecycle.ts";
import { LineRange } from "../core/ranges/lineRange.ts";
import { LanguageId } from "../encodedTokenAttributes.ts";
import type { ILanguageIdCodec, ITokenizationSupport } from "../languages.ts";
import type { IState } from "../languages/iState.ts";
import type { ITextModel } from "../model.ts";
import type { IDocumentContentChange } from "../model/iDocumentContentChange.ts";
import type { ITextDocument } from "../model/iTextDocument.ts";
import { DefaultBackgroundTokenizer, TokenizerWithStateStoreAndTextModel } from "../model/textModelTokens.ts";

import type { ContiguousMultilineTokens } from "./contiguousMultilineTokens.ts";
import { ContiguousMultilineTokensBuilder } from "./contiguousMultilineTokensBuilder.ts";
import { toUint32Array } from "./contiguousTokensEditing.ts";
import { LineTokens } from "./lineTokens.ts";

/** Document lines whose tokens changed; 0-based, `toLine` inclusive. */
export interface ITokensChangedEvent {
    readonly fromLine: number;
    readonly toLine: number;
}

/**
 * Adapter to the ported upstream tokenization (`model/textModelTokens.ts`), the
 * counterpart of upstream `TokenizerSyntaxTokenBackend`. The vendored copy counts lines
 * from 1, here they are 0-based: the ±1 lives only in this file
 * (docs/arch/Editor.md#координаты-ядро-0-based-вендор-1-based).
 */
export class DocumentTokenStore extends Disposable {
    private readonly document: ITextDocument;
    private support: ITokenizationSupport;
    private readonly textModel: ITextModel;

    /**
     * Like upstream `ContiguousTokensStore`: two numbers per token, the END offset and
     * metadata. `undefined` means not tokenized or edited since.
     */
    private cachedTokens!: (Uint32Array | undefined)[];
    /** Languages are not encoded by id: metadata always holds 0, decoding returns the document language. */
    private readonly languageIdCodec: ILanguageIdCodec;
    // All three are set by resetTokenization() from the constructor.
    private tokenizer!: TokenizerWithStateStoreAndTextModel;
    private backgroundTokenizer!: DefaultBackgroundTokenizer;
    private backgroundTokenizationCompleted!: boolean;

    /** Memo key for the heuristic viewport: the same viewport at the same version is not guessed twice. */
    private version = 0;
    private heuristicViewport: { start: number; end: number; version: number } | undefined;

    private readonly onDidChangeTokensEmitter = this.register(new Emitter<ITokensChangedEvent>());
    /** Only for changes not requested by rendering: background or {@link forceTokenization}. */
    public readonly onDidChangeTokens: Event<ITokensChangedEvent> = this.onDidChangeTokensEmitter.event;

    public constructor(document: ITextDocument, support: ITokenizationSupport) {
        super();
        this.document = document;
        this.support = support;
        this.languageIdCodec = {
            // Stryker disable next-line ArrowFunction: `undefined` shifted into metadata gives the same 0
            encodeLanguageId: () => LanguageId.Null,
            decodeLanguageId: () => document.languageId,
        };
        this.textModel = {
            // Upstream puts the language only into token metadata via the codec; ours returns 0 for any language.
            // Stryker disable next-line ArrowFunction: equivalent, the value goes nowhere
            getLanguageId: () => document.languageId,
            getLineCount: () => document.lineCount,
            getLineContent: (lineNumber) => document.getLineContent(lineNumber - 1),
            getLineLength: (lineNumber) => document.getLineLength(lineNumber - 1),
            getLineFirstNonWhitespaceColumn: (lineNumber) =>
                firstNonWhitespaceColumn(document.getLineContent(lineNumber - 1)),
            // The store lives as long as the view; after dispose DefaultBackgroundTokenizer stops itself.
            isAttachedToEditor: () => true,
        };

        this.resetTokenization();

        this.register(
            document.onDidChangeContent((change) => {
                this.handleContentChange(change);
            }),
        );
        this.register({
            dispose: () => {
                this.backgroundTokenizer.dispose();
            },
        });
    }

    /** A later edit does not reset the flag, as upstream. */
    public get isBackgroundTokenizationCompleted(): boolean {
        return this.backgroundTokenizationCompleted;
    }

    public setTokenizationSupport(support: ITokenizationSupport): void {
        this.support = support;
        this.resetTokenization();
    }

    public getLineTokens(line: number): LineTokens | undefined {
        if (line < 0 || line >= this.document.lineCount) return undefined;
        const tokens = this.cachedTokens[line];
        if (tokens === undefined) return undefined;
        return new LineTokens(tokens, this.document.getLineContent(line), this.languageIdCodec);
    }

    /** The last token end is the line length; the next tokenization of the line overwrites these. */
    public setLineTokens(line: number, tokens: Uint32Array): void {
        if (line < 0 || line >= this.document.lineCount) return;
        this.cachedTokens[line] = tokens;
    }

    /**
     * Upstream `refreshRange`, synchronous and event-free: rendering reads it right away.
     * Deviation: upstream refreshes the viewport when visible lines change and paints an
     * edit by shifting old tokens; our edited lines are empty, so this runs every frame,
     * and a repeated heuristic for the same viewport at the same version is skipped.
     */
    public tokenizeViewport(startLine: number, endLine: number): void {
        const lineCount = this.document.lineCount;
        const start = Math.max(1, Math.min(lineCount, startLine + 1));
        const end = Math.min(lineCount, endLine + 1);
        const memo = this.heuristicViewport;
        if (memo?.start === start && memo.end === end && memo.version === this.version) return;

        const builder = new ContiguousMultilineTokensBuilder();
        const { heuristicTokens } = this.tokenizer.tokenizeHeuristically(builder, start, end);
        if (!heuristicTokens && !this.tokenizer.hasAccurateTokensForLine(end)) {
            // Upstream skips the line equal to the first invalid one (`end <= firstInvalid`
            // means "nothing to do"): its start state is exact and its tokens survived the
            // edit by shifting. Our edited line is empty, so tokenize it, or the viewport
            // bottom flashes unhighlighted.
            this.tokenizer.updateTokensUntilLine(builder, end);
        }
        const changes = this.setTokens(builder.finalize(), false);

        if (heuristicTokens) {
            this.heuristicViewport = { start, end, version: this.version };
            // We overrode tokens with heuristically computed ones.
            // Because old states might get reused (thus stopping invalidation),
            // we have to explicitly request the tokens for the changed ranges again.
            for (const change of changes) {
                this.backgroundTokenizer.requestTokens(change.fromLine + 1, change.toLine + 2);
            }
        }

        this.backgroundTokenizer.checkFinished();
    }

    /** Not for rendering: on a large file past the background frontier this is slow. */
    public forceTokenization(line: number): void {
        const builder = new ContiguousMultilineTokensBuilder();
        this.tokenizer.updateTokensUntilLine(builder, line + 1);
        this.setTokens(builder.finalize(), true);
        this.backgroundTokenizer.checkFinished();
    }

    public tokenizeIfCheap(line: number): void {
        if (this.tokenizer.isCheapToTokenize(line + 1)) this.forceTokenization(line);
    }

    public hasAccurateTokensForLine(line: number): boolean {
        return this.tokenizer.hasAccurateTokensForLine(line + 1);
    }

    public getEndState(line: number): IState | undefined {
        return this.tokenizer.store.getEndState(line + 1) ?? undefined;
    }

    private resetTokenization(): void {
        this.cachedTokens = [];
        this.cachedTokens.length = this.document.lineCount;
        // Stryker disable next-line UpdateOperator: versions only need to differ, "--" works too
        this.version++;
        this.backgroundTokenizationCompleted = false;
        // Undefined only on the first call, from the constructor.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        this.backgroundTokenizer?.dispose();

        this.tokenizer = new TokenizerWithStateStoreAndTextModel(
            this.document.lineCount,
            this.support,
            this.textModel,
            this.languageIdCodec,
        );
        this.backgroundTokenizer = new DefaultBackgroundTokenizer(this.tokenizer, {
            setTokens: (tokens) => {
                this.setTokens(tokens, true);
            },
            backgroundTokenizationFinished: () => {
                this.backgroundTokenizationCompleted = true;
            },
        });
        this.backgroundTokenizer.handleChanges();
    }

    private setTokens(tokens: readonly ContiguousMultilineTokens[], fire: boolean): ITokensChangedEvent[] {
        const changes: ITokensChangedEvent[] = [];
        for (const block of tokens) {
            for (let lineNumber = block.startLineNumber; lineNumber <= block.endLineNumber; lineNumber++) {
                // Upstream yields ArrayBuffer and null only after an edit inside the block, never from the builder.
                const tokens = block.getLineTokens(lineNumber);
                // Stryker disable next-line ConditionalExpression: the builder never yields null (see above)
                this.cachedTokens[lineNumber - 1] = tokens === null ? undefined : toUint32Array(tokens);
            }
            changes.push({ fromLine: block.startLineNumber - 1, toLine: block.endLineNumber - 1 });
        }
        if (fire) {
            for (const change of changes) this.onDidChangeTokensEmitter.fire(change);
        }
        return changes;
    }

    private handleContentChange(change: IDocumentContentChange): void {
        const { startLine, oldEndLine, newEndLine } = change;
        const lineDelta = newEndLine - oldEndLine;

        if (lineDelta > 0) {
            this.cachedTokens.splice(
                oldEndLine + 1,
                0,
                ...new Array<Uint32Array | undefined>(lineDelta).fill(undefined),
            );
        } else if (lineDelta < 0) {
            this.cachedTokens.splice(newEndLine + 1, -lineDelta);
        }
        // Edited lines stay empty until retokenized: old tokens would land on wrong offsets.
        // The viewport retokenizes them by the next frame, the background does the rest.
        this.cachedTokens.fill(undefined, startLine, newEndLine + 1);

        // Stryker disable next-line UpdateOperator: versions only need to differ, "--" works too
        this.version++;
        this.tokenizer.store.acceptChange(new LineRange(startLine + 1, oldEndLine + 2), newEndLine - startLine + 1);
        this.backgroundTokenizer.handleChanges();
    }
}

/** 1-based column; 0 when there is no non-whitespace (search returns -1). */
function firstNonWhitespaceColumn(text: string): number {
    return text.search(/[^ \t]/) + 1;
}
