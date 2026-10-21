import type { IGrammar } from "vscode-textmate";
import vsctm from "vscode-textmate";

import { LanguageId } from "../../../../editor/common/encodedTokenAttributes.ts";
import type { ITokenizationSupport } from "../../../../editor/common/languages.ts";
import { EncodedTokenizationResult } from "../../../../editor/common/languages.ts";
import type { IState } from "../../../../editor/common/languages/iState.ts";
import { nullTokenizeEncoded } from "../../../../editor/common/languages/nullTokenize.ts";

import { TextMateState } from "./textMateState.ts";

/** Защита от ReDoS в oniguruma — upstream `editor.maxTokenizationLineLength`; длиннее — один токен. */
const MAX_LINE_LENGTH = 20_000;

/** Upstream: строку, на которую грамматика тратит больше, бросаем недотокенизированной. */
const TIME_LIMIT_MS = 500;

/** Upstream `TextMateTokenizationSupport.tokenizeEncoded`: цвет в токенах — индекс colorMap темы. */
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
            // Stryker disable next-line ArrayDeclaration: шрифтов у токенов нет, массив никто не читает
            return new EncodedTokenizationResult(result.tokens, [], state);
        }
        // Неизменное состояние — тот же объект: экономим аллокацию на строку.
        const endState = state.stack.equals(result.ruleStack) ? state : new TextMateState(result.ruleStack);
        // Stryker disable next-line ArrayDeclaration: см. выше
        return new EncodedTokenizationResult(result.tokens, [], endState);
    }
}
