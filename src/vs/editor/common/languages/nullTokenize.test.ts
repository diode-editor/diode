import { describe, expect, it } from "vitest";

import { markedMetadata } from "../../../../TestUtils/encodedTokens.ts";
import { ColorId, LanguageId, StandardTokenType, TokenMetadata } from "../encodedTokenAttributes.ts";
import { LineTokens } from "../tokens/lineTokens.ts";

import { NULL_STATE } from "./iState.ts";
import { NullState, nullTokenizeEncoded } from "./nullTokenize.ts";

describe("nullTokenizeEncoded", () => {
    it("one token from line start: other, default colors; the same state", () => {
        const result = nullTokenizeEncoded(LanguageId.Null, NULL_STATE);
        expect(result.tokens).toHaveLength(2);
        expect(result.tokens[0]).toBe(0);
        const metadata = result.tokens[1];
        expect(TokenMetadata.getTokenType(metadata)).toBe(StandardTokenType.Other);
        expect(TokenMetadata.getForeground(metadata)).toBe(ColorId.DefaultForeground);
        expect(TokenMetadata.getBackground(metadata)).toBe(ColorId.DefaultBackground);
        expect(result.endState).toBe(NULL_STATE);
    });

    it("no state — NullState; each call returns its own array (the pipeline edits it in place)", () => {
        const first = nullTokenizeEncoded(LanguageId.Null, null);
        expect(first.endState).toBe(NullState);
        expect(nullTokenizeEncoded(LanguageId.Null, null).tokens).not.toBe(first.tokens);
    });
});

describe("LineTokens.convertToEndOffset", () => {
    it("converts token starts to ends in place, the last one ends at the line end", () => {
        const tokens = new Uint32Array([0, markedMetadata(11), 3, markedMetadata(12)]);
        LineTokens.convertToEndOffset(tokens, 10);
        expect(tokens).toEqual(new Uint32Array([3, markedMetadata(11), 10, markedMetadata(12)]));
    });
});
