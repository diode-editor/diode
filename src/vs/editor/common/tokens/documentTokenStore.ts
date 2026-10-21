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

/** Строки документа, чьи токены сменились; 0-based, `toLine` включительно. */
export interface ITokensChangedEvent {
    readonly fromLine: number;
    readonly toLine: number;
}

/**
 * Адаптер к перенесённой токенизации эталона (`model/textModelTokens.ts`),
 * аналог upstream `TokenizerSyntaxTokenBackend`. Вендор — в строках с 1, здесь
 * 0-based: ±1 только в этом файле (docs/arch/Editor.md, «Координаты»).
 */
export class DocumentTokenStore extends Disposable {
    private readonly document: ITextDocument;
    private support: ITokenizationSupport;
    private readonly textModel: ITextModel;

    /**
     * Как `ContiguousTokensStore` эталона: по два числа на токен — смещение КОНЦА
     * и метаданные. `undefined` — не токенизирована или правлена после.
     */
    private cachedTokens!: (Uint32Array | undefined)[];
    /** Языки по id не кодируем: в метаданных всегда 0, обратно — язык документа. */
    private readonly languageIdCodec: ILanguageIdCodec;
    // Все три ставит resetTokenization() из конструктора.
    private tokenizer!: TokenizerWithStateStoreAndTextModel;
    private backgroundTokenizer!: DefaultBackgroundTokenizer;
    private backgroundTokenizationCompleted!: boolean;

    /** Ключ памяти эвристического вьюпорта: тот же вьюпорт той же версии второй раз не угадываем. */
    private version = 0;
    private heuristicViewport: { start: number; end: number; version: number } | undefined;

    private readonly onDidChangeTokensEmitter = this.register(new Emitter<ITokensChangedEvent>());
    /** Только не по запросу рендера: фон или {@link forceTokenization}. */
    public readonly onDidChangeTokens: Event<ITokensChangedEvent> = this.onDidChangeTokensEmitter.event;

    public constructor(document: ITextDocument, support: ITokenizationSupport) {
        super();
        this.document = document;
        this.support = support;
        this.languageIdCodec = {
            // Stryker disable next-line ArrowFunction: `undefined` в метаданных сдвигом даёт тот же 0
            encodeLanguageId: () => LanguageId.Null,
            decodeLanguageId: () => document.languageId,
        };
        this.textModel = {
            // Язык эталон кладёт только в метаданные токенов через кодек, а наш кодек отдаёт 0 на любой язык.
            // Stryker disable next-line ArrowFunction: эквивалентный — значение никуда не доходит
            getLanguageId: () => document.languageId,
            getLineCount: () => document.lineCount,
            getLineContent: (lineNumber) => document.getLineContent(lineNumber - 1),
            getLineLength: (lineNumber) => document.getLineLength(lineNumber - 1),
            getLineFirstNonWhitespaceColumn: (lineNumber) =>
                firstNonWhitespaceColumn(document.getLineContent(lineNumber - 1)),
            // Стор живёт ровно столько, сколько вью; после dispose фон глушит сам DefaultBackgroundTokenizer.
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

    /** Правка позже флаг не сбрасывает — как у эталона. */
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

    /** Последний конец токена — длина строки; следующая токенизация строки перезапишет. */
    public setLineTokens(line: number, tokens: Uint32Array): void {
        if (line < 0 || line >= this.document.lineCount) return;
        this.cachedTokens[line] = tokens;
    }

    /**
     * Upstream `refreshRange`, синхронно и без событий: рендер прочтёт сразу.
     * Отличие от эталона: тот обновляет вьюпорт при смене видимых строк и красит
     * правку сдвигом старых токенов; у нас правленые строки пусты, поэтому зовём
     * на каждый кадр, а повторную эвристику того же вьюпорта той же версии отсекаем.
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
            // Эталон не трогает строку, равную первой невалидной (`end <=
            // firstInvalid` — «нечего делать»): её стартовое состояние точно, а
            // токены у него пережили правку сдвигом. У нас правленая строка
            // пуста — досчитываем её, иначе низ вьюпорта мигнёт без подсветки.
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

    /** Не для рендера: на большом файле за фронтиром фона это долго. */
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
        // Stryker disable next-line UpdateOperator: версии важно лишь отличаться — «--» даёт такие же
        this.version++;
        this.backgroundTokenizationCompleted = false;
        // Undefined только на первом вызове — из конструктора.
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
                // ArrayBuffer и null у эталона бывают только после правки внутри блока, не из builder'а.
                const tokens = block.getLineTokens(lineNumber);
                // Stryker disable next-line ConditionalExpression: null из builder'а не приходит (см. выше)
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
        // Правленые строки пусты до пересчёта: старые токены легли бы на чужие
        // смещения. Вьюпорт их пересчитает к кадру, остальное — фон.
        this.cachedTokens.fill(undefined, startLine, newEndLine + 1);

        // Stryker disable next-line UpdateOperator: версии важно лишь отличаться — «--» даёт такие же
        this.version++;
        this.tokenizer.store.acceptChange(new LineRange(startLine + 1, oldEndLine + 2), newEndLine - startLine + 1);
        this.backgroundTokenizer.handleChanges();
    }
}

/** Колонка с 1; 0 — не-пробелов нет (search даёт -1). */
function firstNonWhitespaceColumn(text: string): number {
    return text.search(/[^ \t]/) + 1;
}
