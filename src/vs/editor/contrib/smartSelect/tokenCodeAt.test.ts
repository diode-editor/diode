import { describe, expect, it } from "vitest";

import { encodedResult, tokenMetadata } from "../../../../TestUtils/encodedTokens.ts";
import { createPosition } from "../../common/core/iPosition.ts";
import { createRange } from "../../common/core/iRange.ts";
import { StandardTokenType } from "../../common/encodedTokenAttributes.ts";
import type { ITokenizationSupport } from "../../common/languages.ts";
import { NULL_STATE } from "../../common/languages/iState.ts";
import { TextDocument } from "../../common/model/textDocument.ts";
import { DocumentTokenStore } from "../../common/tokens/documentTokenStore.ts";

import { tokenCodeAt } from "./tokenCodeAt.ts";

/** Everything from the first `"` to the line end is a string literal. */
const QUOTE_TO_END: ITokenizationSupport = {
    getInitialState: () => NULL_STATE,
    tokenizeEncoded: (line) => {
        const quote = line.indexOf('"');
        const tokens: [number, number][] = [[0, tokenMetadata()]];
        if (quote !== -1) tokens.push([quote, tokenMetadata({ tokenType: StandardTokenType.String })]);
        return encodedResult(tokens, NULL_STATE);
    },
};

const TEXT = 'x"(\ny"(\nz"(';

describe("tokenCodeAt: non-code brackets by tokens", () => {
    it("lines up to the lowest cursor are tokenized: a literal is not code; past it there are no tokens, so code", () => {
        const store = new DocumentTokenStore(new TextDocument(TEXT), QUOTE_TO_END);
        const codeAt = tokenCodeAt(store, [createPosition(1, 0), createPosition(0, 0)]);
        expect([codeAt(0, 0), codeAt(0, 2), codeAt(1, 2), codeAt(2, 2)]).toEqual([true, false, false, true]);
    });

    it("stale tokens past a dirty line do not count: code", () => {
        const document = new TextDocument(TEXT);
        const store = new DocumentTokenStore(document, QUOTE_TO_END);
        store.forceTokenization(2);
        // Editing line 1 may make line 2's cache wrong (the edit could open or close a
        // literal), so it doesn't count until retokenized.
        document.applyEdits([{ range: createRange(1, 0, 1, 0), text: "w" }]);
        const codeAt = tokenCodeAt(store, [createPosition(0, 0)]);
        expect([codeAt(0, 2), codeAt(2, 2)]).toEqual([false, true]);
    });

    it("without a grammar everything is code", () => {
        expect(tokenCodeAt(undefined, [createPosition(0, 0)])(0, 0)).toBe(true);
    });
});
