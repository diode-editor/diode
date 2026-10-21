import type { IGrammar } from "vscode-textmate";
import vsctm from "vscode-textmate";

import { LanguageId } from "../../../../editor/common/encodedTokenAttributes.ts";
import type { ITokenizationSupport } from "../../../../editor/common/languages.ts";
import { EncodedTokenizationResult } from "../../../../editor/common/languages.ts";
import type { IState } from "../../../../editor/common/languages/iState.ts";
import { nullTokenizeEncoded } from "../../../../editor/common/languages/nullTokenize.ts";

import { TextMateState } from "./textMateState.ts";

/** ReDoS guard for oniguruma, upstream `editor.maxTokenizationLineLength`; a longer line is one token. */
const MAX_LINE_LENGTH = 20_000;

/** Upstream: a line the grammar spends longer on is left partially tokenized. */
const TIME_LIMIT_MS = 500;

/** Upstream `TextMateTokenizationSupport.tokenizeEncoded`: the color in tokens is a theme colorMap index. */
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
            // As upstream: the tokens produced so far and the line's start state.
            // Stryker disable next-line ArrayDeclaration: tokens have no fonts, nobody reads the array
            return new EncodedTokenizationResult(result.tokens, [], state);
        }
        // An unchanged state is the same object: saves an allocation per line.
        const endState = state.stack.equals(result.ruleStack) ? state : new TextMateState(result.ruleStack);
        // Stryker disable next-line ArrayDeclaration: see above
        return new EncodedTokenizationResult(result.tokens, [], endState);
    }
}
