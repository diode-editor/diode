import type { IGrammar } from "vscode-textmate";
import vsctm from "vscode-textmate";

import { LanguageId } from "../../../../editor/common/encodedTokenAttributes.ts";
import type {
    IBackgroundTokenizationStore,
    IBackgroundTokenizer,
    ITokenizationSupport,
} from "../../../../editor/common/languages.ts";
import { EncodedTokenizationResult } from "../../../../editor/common/languages.ts";
import type { IState } from "../../../../editor/common/languages/iState.ts";
import { nullTokenizeEncoded } from "../../../../editor/common/languages/nullTokenize.ts";
import type { ITextDocument } from "../../../../editor/common/model/iTextDocument.ts";

import { TextMateState } from "./textMateState.ts";

/**
 * Защита от ReDoS в oniguruma — экстремально длинные строки не токенизируются:
 * один токен цвета по умолчанию (upstream `editor.maxTokenizationLineLength`,
 * 20000, `TokenizationSupportWithLineLimit` → `nullTokenizeEncoded`).
 */
const MAX_LINE_LENGTH = 20_000;

/** Upstream: строку, на которую грамматика тратит больше, бросаем недотокенизированной. */
const TIME_LIMIT_MS = 500;

export type BackgroundTokenizerFactory = (
    document: ITextDocument,
    store: IBackgroundTokenizationStore,
) => IBackgroundTokenizer | undefined;

/**
 * Адаптер `vscode-textmate.IGrammar` под токенизатор модели — upstream
 * `TextMateTokenizationSupport.tokenizeEncoded`: бинарные токены
 * `IGrammar.tokenizeLine2` (цвет — индекс в colorMap темы, заданной
 * `Registry.setTheme`, см. `TextMateGrammarLoader.setTheme`).
 */
export class TextMateTokenizationSupport implements ITokenizationSupport {
    private readonly grammar: IGrammar;
    private readonly backgroundTokenizerFactory: BackgroundTokenizerFactory | undefined;
    private tokenized = false;

    /**
     * @param createBackgroundTokenizer фон документа вне этого потока (upstream —
     *   `ThreadedBackgroundTokenizerFactory.createBackgroundTokenizer`); нет —
     *   фон в главном потоке.
     */
    public constructor(grammar: IGrammar, createBackgroundTokenizer?: BackgroundTokenizerFactory) {
        this.grammar = grammar;
        this.backgroundTokenizerFactory = createBackgroundTokenizer;
    }

    /** Грамматика ещё ничего не токенизировала: её regex'ы не скомпилированы (см. `ITokenizationSupport.isCold`). */
    public get isCold(): boolean {
        return !this.tokenized;
    }

    public createBackgroundTokenizer(
        document: ITextDocument,
        store: IBackgroundTokenizationStore,
    ): IBackgroundTokenizer | undefined {
        return this.backgroundTokenizerFactory?.(document, store);
    }

    public getInitialState(): IState {
        return new TextMateState(vsctm.INITIAL);
    }

    public tokenizeEncoded(line: string, _hasEOL: boolean, state: IState): EncodedTokenizationResult {
        if (!(state instanceof TextMateState)) {
            throw new Error("TextMateTokenizationSupport: incompatible IState");
        }
        this.tokenized = true;

        if (line.length > MAX_LINE_LENGTH) {
            return nullTokenizeEncoded(LanguageId.Null, state);
        }

        const result = this.grammar.tokenizeLine2(line, state.stack, TIME_LIMIT_MS);
        if (result.stoppedEarly) {
            // Как у эталона: токены, что успели, и состояние начала строки.
            // Stryker disable next-line ArrayDeclaration: шрифтов у токенов нет, массив никто не читает
            return new EncodedTokenizationResult(result.tokens, [], state);
        }
        // Неизменное состояние — тот же объект: экономим аллокацию на строку.
        const endState = state.stack.equals(result.ruleStack) ? state : new TextMateState(result.ruleStack);
        // Stryker disable next-line ArrayDeclaration: см. выше
        return new EncodedTokenizationResult(result.tokens, [], endState);
    }
}
