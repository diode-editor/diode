import { describe, expect, it } from "vitest";

import { EncodedTokenizationResult, Token, TokenizationResult } from "./languages.ts";
import { NULL_STATE } from "./languages/iState.ts";
import { nullTokenize } from "./languages/nullTokenize.ts";

describe("languages.ts (shim of the upstream tokenizer contract)", () => {
    it("Token stores offset, type and language; toString matches upstream", () => {
        const token = new Token(3, "keyword", "typescript");
        expect(token).toMatchObject({ offset: 3, type: "keyword", language: "typescript" });
        expect(token.toString()).toBe("(3, keyword)");
    });

    it("nullTokenize (upstream string path) — one empty language token and the same state", () => {
        const result = nullTokenize("plaintext", NULL_STATE);
        expect(result).toBeInstanceOf(TokenizationResult);
        expect(result.tokens).toEqual([new Token(0, "", "plaintext")]);
        expect(result.endState).toBe(NULL_STATE);
    });

    it("EncodedTokenizationResult stores tokens, fonts and state", () => {
        const tokens = new Uint32Array([0, 1]);
        const result = new EncodedTokenizationResult(tokens, [], NULL_STATE);
        expect(result.tokens).toBe(tokens);
        expect(result.fontInfo).toEqual([]);
        expect(result.endState).toBe(NULL_STATE);
    });
});
