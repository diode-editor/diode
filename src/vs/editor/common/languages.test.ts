import { describe, expect, it } from "vitest";

import { EncodedTokenizationResult, Token, TokenizationResult } from "./languages.ts";
import { NULL_STATE } from "./languages/iState.ts";
import { nullTokenize } from "./languages/nullTokenize.ts";

describe("languages.ts (шим upstream-контракта токенизатора)", () => {
    it("Token хранит смещение, тип и язык; toString — как у эталона", () => {
        const token = new Token(3, "keyword", "typescript");
        expect(token).toMatchObject({ offset: 3, type: "keyword", language: "typescript" });
        expect(token.toString()).toBe("(3, keyword)");
    });

    it("nullTokenize (строковый путь эталона) — один пустой токен языка и то же состояние", () => {
        const result = nullTokenize("plaintext", NULL_STATE);
        expect(result).toBeInstanceOf(TokenizationResult);
        expect(result.tokens).toEqual([new Token(0, "", "plaintext")]);
        expect(result.endState).toBe(NULL_STATE);
    });

    it("EncodedTokenizationResult хранит токены, шрифты и состояние", () => {
        const tokens = new Uint32Array([0, 1]);
        const result = new EncodedTokenizationResult(tokens, [], NULL_STATE);
        expect(result.tokens).toBe(tokens);
        expect(result.fontInfo).toEqual([]);
        expect(result.endState).toBe(NULL_STATE);
    });
});
