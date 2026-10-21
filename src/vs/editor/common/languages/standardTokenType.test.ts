import { describe, expect, it } from "vitest";

import { storedTokens, tokenMetadata } from "../../../../TestUtils/encodedTokens.ts";
import { StandardTokenType } from "../encodedTokenAttributes.ts";
import { LineTokens } from "../tokens/lineTokens.ts";

import { standardTokenTypeAt } from "./standardTokenType.ts";

const codec = { encodeLanguageId: (): number => 0, decodeLanguageId: (): string => "test" };

function lineTokens(text: string, tokens: readonly (readonly [number, StandardTokenType])[]): LineTokens {
    const pairs = tokens.map(([start, tokenType]) => [start, tokenMetadata({ tokenType })] as const);
    return new LineTokens(storedTokens(pairs, text.length), text, codec);
}

describe("standardTokenTypeAt — token type from metadata", () => {
    const text = 'let "str" // comment  /re/';
    const tokens = lineTokens(text, [
        [0, StandardTokenType.Other],
        [4, StandardTokenType.String],
        [10, StandardTokenType.Comment],
        [20, StandardTokenType.Other],
        [22, StandardTokenType.RegEx],
    ]);

    it("string, comment, other — by the covering token", () => {
        expect(standardTokenTypeAt(tokens, 0)).toBe("other");
        expect(standardTokenTypeAt(tokens, 3)).toBe("other");
        expect(standardTokenTypeAt(tokens, 4)).toBe("string");
        expect(standardTokenTypeAt(tokens, 9)).toBe("string");
        expect(standardTokenTypeAt(tokens, 10)).toBe("comment");
        expect(standardTokenTypeAt(tokens, 19)).toBe("comment");
        expect(standardTokenTypeAt(tokens, 20)).toBe("other");
    });

    it("regex — other", () => {
        expect(standardTokenTypeAt(tokens, 23)).toBe("other");
    });

    it("an offset past the last token — the last token's type", () => {
        const comment = lineTokens("// x", [[0, StandardTokenType.Comment]]);
        expect(standardTokenTypeAt(comment, 4)).toBe("comment");
        expect(standardTokenTypeAt(comment, 100)).toBe("comment");
    });

    it("no tokens — other", () => {
        expect(standardTokenTypeAt(undefined, 3)).toBe("other");
    });
});
