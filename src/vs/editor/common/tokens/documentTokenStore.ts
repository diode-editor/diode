import { runWhenGlobalIdle } from "../../../base/common/async.ts";
import type { Event } from "../../../base/common/event.ts";
import { Emitter } from "../../../base/common/event.ts";
import type { IDisposable } from "../../../base/common/lifecycle.ts";
import { Disposable } from "../../../base/common/lifecycle.ts";
import { LineRange } from "../core/ranges/lineRange.ts";
import { LanguageId } from "../encodedTokenAttributes.ts";
import type {
    IBackgroundTokenizationStore,
    IBackgroundTokenizer,
    ILanguageIdCodec,
    ITokenizationSupport,
} from "../languages.ts";
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
 * Per-document cache of line tokens — адаптер к перенесённой из эталона
 * токенизации (`model/textModelTokens.ts`), наш аналог upstream
 * `TokenizerSyntaxTokenBackend`.
 *
 * Как у эталона:
 * - **фон** — `DefaultBackgroundTokenizer` идёт по невалидным строкам кусками
 *   по ~1 мс и кладёт токены сюда ({@link onDidChangeTokens});
 * - **вьюпорт** — {@link tokenizeViewport}: строки, до которых фон уже дошёл,
 *   досчитываются точно, а вьюпорт за фронтиром красится эвристикой
 *   (стартовое состояние угадано по строкам с меньшим отступом) и
 *   перезаписывается фоном, когда тот доберётся;
 * - **каретка** — {@link forceTokenization} / {@link tokenizeIfCheap}.
 *
 * Перенесённый код живёт в координатах эталона (строки с 1); здесь — наши
 * 0-based строки. ±1 только в этом файле (docs/arch/Editor.md, «Координаты»).
 */
export class DocumentTokenStore extends Disposable {
    private readonly document: ITextDocument;
    private support: ITokenizationSupport;
    private readonly textModel: ITextModel;

    /**
     * Бинарные токены строк, как их хранит эталон (`ContiguousTokensStore`):
     * по два числа на токен — смещение КОНЦА токена и метаданные
     * (`encodedTokenAttributes.ts`). `undefined` — строка не токенизирована
     * или правлена после токенизации.
     */
    private cachedTokens!: (Uint32Array | undefined)[];
    /**
     * Языки по id мы не кодируем (`languages.ts`): в метаданных всегда 0, а
     * обратно — язык документа.
     */
    private readonly languageIdCodec: ILanguageIdCodec;
    // Все три ставит resetTokenization() из конструктора.
    private tokenizer!: TokenizerWithStateStoreAndTextModel;
    private backgroundTokenizer!: IBackgroundTokenizer;
    private backgroundTokenizationCompleted!: boolean;
    /** Фон в этом потоке; `undefined` — у токенизатора свой фон (воркер). */
    private defaultBackgroundTokenizer: DefaultBackgroundTokenizer | undefined;
    /**
     * Свой фон токенизатора ещё ничего не прислал. Пока так, а токенизатор
     * холодный (`ITokenizationSupport.isCold`), вьюпорт ждёт фон — см.
     * {@link tokenizeViewport}.
     */
    private awaitingBackground = false;
    /** Прогрев токенизатора этого потока после первого ответа фона — {@link scheduleWarmUp}. */
    private warmUp: IDisposable | undefined;
    /** Вьюпорт последнего кадра (строки с 1) — его строки и греют токенизатор. */
    private lastViewport: { start: number; end: number } | undefined;

    /**
     * Растёт на каждую правку и смену токенизатора. Ключ памяти эвристического
     * вьюпорта: тот же вьюпорт той же версии второй раз не угадываем.
     */
    private version = 0;
    private heuristicViewport: { start: number; end: number; version: number } | undefined;

    private readonly onDidChangeTokensEmitter = this.register(new Emitter<ITokensChangedEvent>());
    /**
     * Токены строк сменились не по запросу рендера: их положил фон или
     * {@link forceTokenization}. Вью перерисовывается, если строки на экране.
     */
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
            // Стор живёт ровно столько, сколько вью (его держит EditorComponent):
            // пока он есть, он «прикреплён». После dispose фон глушит сам
            // DefaultBackgroundTokenizer.
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
                this.warmUp?.dispose();
            },
        });
    }

    /**
     * Фон прошёл весь документ (upstream `BackgroundTokenizationState.Completed`).
     * Правка позже флаг не сбрасывает — как у эталона.
     */
    public get isBackgroundTokenizationCompleted(): boolean {
        return this.backgroundTokenizationCompleted;
    }

    /**
     * Replaces the active tokenizer (e.g. when a new language is detected).
     * Invalidates the entire cache.
     */
    public setTokenizationSupport(support: ITokenizationSupport): void {
        this.support = support;
        this.resetTokenization();
    }

    /** Токены строки `line` (upstream `LineTokens`), `undefined` — ещё не токенизирована. */
    public getLineTokens(line: number): LineTokens | undefined {
        if (line < 0 || line >= this.document.lineCount) return undefined;
        const tokens = this.cachedTokens[line];
        if (tokens === undefined) return undefined;
        return new LineTokens(tokens, this.document.getLineContent(line), this.languageIdCodec);
    }

    /**
     * Externally-supplied tokens (tests): бинарные, концы токенов, последний
     * конец — длина строки. Bypasses the registered ITokenizationSupport for
     * that line; the next tokenization of the line overwrites it.
     */
    public setLineTokens(line: number, tokens: Uint32Array): void {
        if (line < 0 || line >= this.document.lineCount) return;
        this.cachedTokens[line] = tokens;
    }

    /**
     * Токены вьюпорта `[startLine .. endLine]` к кадру — upstream `refreshRange`.
     * Синхронно и без событий: зовёт рендер, который их сейчас же и прочтёт.
     *
     * Дошёл фон до начала вьюпорта — строки досчитываются точно (их немного).
     * Не дошёл — эвристика без кэша состояний, а фон просят пересчитать эти
     * строки честно. Отличие от эталона: тот обновляет вьюпорт при смене
     * видимых строк, а правку внутри него красит сдвигом старых токенов до
     * прихода фона; у нас рендер тянет токены сам, правленые строки кэша пусты,
     * поэтому зовём на каждый кадр, а повторную эвристику того же вьюпорта той
     * же версии отсекаем.
     */
    public tokenizeViewport(startLine: number, endLine: number): void {
        const lineCount = this.document.lineCount;
        const start = Math.max(1, Math.min(lineCount, startLine + 1));
        const end = Math.min(lineCount, endLine + 1);
        this.lastViewport = { start, end };
        // Отступление (B3): холодная грамматика скомпилировала бы здесь свои
        // regex'ы (TypeScript — ~60 мс в кадре), а фон в воркере делает то же
        // вне главного потока и вот-вот пришлёт эти строки. Ждём его — кадр
        // остаётся с текстом без цвета, как до отпуска токенизаторов на старте.
        if (this.awaitingBackground && this.support.isCold === true) return;
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

        this.defaultBackgroundTokenizer?.checkFinished();
    }

    /**
     * Точные токены до строки `line` включительно, сколько бы строк до неё ни
     * осталось (upstream `forceTokenization`). Для каретки и явных команд, не
     * для рендера: на большом файле за фронтиром фона это долго.
     */
    public forceTokenization(line: number): void {
        const builder = new ContiguousMultilineTokensBuilder();
        this.tokenizer.updateTokensUntilLine(builder, line + 1);
        this.setTokens(builder.finalize(), true);
        this.defaultBackgroundTokenizer?.checkFinished();
    }

    /**
     * {@link forceTokenization}, если до строки досчитать дёшево — она уже
     * точна или ровно следующая за фронтиром (upstream `tokenizeIfCheap`).
     * Иначе в кэше остаётся то, что есть (эвристика вьюпорта или пусто).
     */
    public tokenizeIfCheap(line: number): void {
        if (this.tokenizer.isCheapToTokenize(line + 1)) this.forceTokenization(line);
    }

    /** Токены строки посчитаны от точного состояния (а не эвристикой или не посчитаны). */
    public hasAccurateTokensForLine(line: number): boolean {
        return this.tokenizer.hasAccurateTokensForLine(line + 1);
    }

    /** For tests: the cached end state of `line` (after tokenization). */
    public getEndState(line: number): IState | undefined {
        return this.tokenizer.store.getEndState(line + 1) ?? undefined;
    }

    /** Upstream `todo_resetTokenization`: всё заново, фон — с первой строки. */
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
        const tokenizer = this.tokenizer;
        const store: IBackgroundTokenizationStore = {
            setTokens: (tokens) => {
                if (this.awaitingBackground) {
                    this.awaitingBackground = false;
                    this.scheduleWarmUp();
                }
                this.setTokens(tokens, true);
            },
            setEndState: (lineNumber, state) => {
                const firstInvalidEndStateLineNumber = tokenizer.store.getFirstInvalidEndStateLineNumber();
                // Don't accept states for definitely valid states, the renderer is ahead of the worker!
                if (firstInvalidEndStateLineNumber !== null && lineNumber >= firstInvalidEndStateLineNumber) {
                    tokenizer.store.setEndState(lineNumber, state);
                }
            },
            backgroundTokenizationFinished: () => {
                this.backgroundTokenizationCompleted = true;
            },
        };
        const background = this.support.createBackgroundTokenizer?.(this.document, store);
        if (background === undefined) {
            this.defaultBackgroundTokenizer = new DefaultBackgroundTokenizer(this.tokenizer, store);
            this.backgroundTokenizer = this.defaultBackgroundTokenizer;
            this.awaitingBackground = false;
            this.defaultBackgroundTokenizer.handleChanges();
        } else {
            this.defaultBackgroundTokenizer = undefined;
            this.backgroundTokenizer = background;
            this.awaitingBackground = true;
        }
    }

    /**
     * Фон прислал первые токены, а токенизатор этого потока так и не работал:
     * первая же правка или прыжок за фронтир фона скомпилировали бы грамматику
     * посреди нажатия. Греем её, как только поток свободен, на строках
     * вьюпорта — результат никуда не кладём (`tokenizeLinesAt` кэш не трогает).
     */
    private scheduleWarmUp(): void {
        if (this.support.isCold !== true) return;
        this.warmUp?.dispose();
        this.warmUp = runWhenGlobalIdle(() => {
            this.warmUp = undefined;
            const viewport = this.lastViewport;
            if (viewport === undefined || this.support.isCold !== true) return;
            const lines: string[] = [];
            const end = Math.min(viewport.end, this.document.lineCount);
            for (let lineNumber = viewport.start; lineNumber <= end; lineNumber++) {
                lines.push(this.textModel.getLineContent(lineNumber));
            }
            this.tokenizer.tokenizeLinesAt(viewport.start, lines);
        });
    }

    private setTokens(tokens: readonly ContiguousMultilineTokens[], fire: boolean): ITokensChangedEvent[] {
        const changes: ITokensChangedEvent[] = [];
        for (const block of tokens) {
            for (let lineNumber = block.startLineNumber; lineNumber <= block.endLineNumber; lineNumber++) {
                // Блоки от builder'а держат строки `Uint32Array` (ArrayBuffer и
                // null у эталона бывают только после правки внутри блока).
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
            // Insert `lineDelta` empty slots after `oldEndLine`.
            this.cachedTokens.splice(
                oldEndLine + 1,
                0,
                ...new Array<Uint32Array | undefined>(lineDelta).fill(undefined),
            );
        } else if (lineDelta < 0) {
            // Remove `-lineDelta` slots from the end of the changed region.
            this.cachedTokens.splice(newEndLine + 1, -lineDelta);
        }
        // Правленые строки пусты до пересчёта: старые токены легли бы на чужие
        // смещения. Вьюпорт их пересчитает к кадру, остальное — фон.
        this.cachedTokens.fill(undefined, startLine, newEndLine + 1);

        // Stryker disable next-line UpdateOperator: версии важно лишь отличаться — «--» даёт такие же
        this.version++;
        this.tokenizer.store.acceptChange(new LineRange(startLine + 1, oldEndLine + 2), newEndLine - startLine + 1);
        this.defaultBackgroundTokenizer?.handleChanges();
    }
}

/** Upstream `getLineFirstNonWhitespaceColumn`: колонка с 1 первого не-пробела и не-таба, 0 — таких нет. */
function firstNonWhitespaceColumn(text: string): number {
    // Не нашлось — search даёт -1, и колонка выходит 0.
    return text.search(/[^ \t]/) + 1;
}
