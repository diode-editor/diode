import { LanguageId } from "../../encodedTokenAttributes.ts";
import type { EncodedTokenizationResult, ITokenizationSupport } from "../../languages.ts";
import type { IState } from "../iState.ts";
import { NULL_STATE } from "../iState.ts";
import { nullTokenizeEncoded } from "../nullTokenize.ts";

/** Язык без грамматики: вся строка — один токен цвета по умолчанию (upstream `nullTokenizeEncoded`). */
export class PlainTextTokenizer implements ITokenizationSupport {
    public getInitialState(): IState {
        return NULL_STATE;
    }

    public tokenizeEncoded(_line: string, _hasEOL: boolean, _state: IState): EncodedTokenizationResult {
        return nullTokenizeEncoded(LanguageId.Null, NULL_STATE);
    }
}
