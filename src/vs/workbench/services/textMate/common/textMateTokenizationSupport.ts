import type { IGrammar } from "vscode-textmate";
import vsctm from "vscode-textmate";

import { LanguageId } from "../../../../editor/common/encodedTokenAttributes.ts";
import type { ITokenizationSupport } from "../../../../editor/common/languages.ts";
import { EncodedTokenizationResult } from "../../../../editor/common/languages.ts";
import type { IState } from "../../../../editor/common/languages/iState.ts";
import { nullTokenizeEncoded } from "../../../../editor/common/languages/nullTokenize.ts";

import { TextMateState } from "./textMateState.ts";

/**
 * Защита от ReDoS в oniguruma — экстремально длинные строки не токенизируются:
 * один токен цвета по умолчанию (upstream `editor.maxTokenizationLineLength`,
 * 20000, `TokenizationSupportWithLineLimit` → `nullTokenizeEncoded`).
 */
const MAX_LINE_LENGTH = 20_000;

/** Upstream: строку, на которую грамматика тратит больше, бросаем недотокенизированной. */
const TIME_LIMIT_MS = 500;

/**
 * Адаптер `vscode-textmate.IGrammar` под токенизатор модели — upstream
 * `TextMateTokenizationSupport.tokenizeEncoded`: бинарные токены
 * `IGrammar.tokenizeLine2` (цвет — индекс в colorMap темы, заданной
 * `Registry.setTheme`, см. `TextMateGrammarLoader.setTheme`).
 */
export class TextMateTokenizationSupport implements ITokenizationSupport {
    private readonly grammar: IGrammar;

    public constructor(grammar: IGrammar) {
        this.grammar = grammar;
    }

    public getInitialState(): IState {
        return new TextMateState(vsctm.INITIAL);
    }

    public tokenizeEncoded(line: string, _hasEOL: boolean, state: IState): EncodedTokenizationResult {
        if (!(state instanceof TextMateState)) {
            throw new Error("TextMateTokenizationSupport: incompatible IState");
        }

        if (line.length > MAX_LINE_LENGTH) {
            return nullTokenizeEncoded(LanguageId.Null, state);
        }

        const result = this.grammar.tokenizeLine2(line, state.stack, TIME_LIMIT_MS);
        if (result.stoppedEarly) {
            // Как у эталона: токены, что успели, и состояние начала строки.
            return new EncodedTokenizationResult(result.tokens, [], state);
        }
        // Неизменное состояние — тот же объект: экономим аллокацию на строку.
        const endState = state.stack.equals(result.ruleStack) ? state : new TextMateState(result.ruleStack);
        return new EncodedTokenizationResult(result.tokens, [], endState);
    }
}
