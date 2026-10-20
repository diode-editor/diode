import { describe, expect, it } from "vitest";

import { ColorId, StandardTokenType, TokenMetadata } from "../../encodedTokenAttributes.ts";

import { WordTokenColor, WordTokenizer } from "./wordTokenizer.ts";

interface IDecodedToken {
    readonly startIndex: number;
    readonly foreground: number;
    readonly tokenType: StandardTokenType;
}

function tokenize(src: string): IDecodedToken[] {
    const t = new WordTokenizer();
    const { tokens } = t.tokenizeEncoded(src, false, t.getInitialState());
    const result: IDecodedToken[] = [];
    for (let i = 0; i < tokens.length; i += 2) {
        result.push({
            startIndex: tokens[i],
            foreground: TokenMetadata.getForeground(tokens[i + 1]),
            tokenType: TokenMetadata.getTokenType(tokens[i + 1]),
        });
    }
    return result;
}

const TEXT = ColorId.DefaultForeground;

describe("WordTokenizer", () => {
    it("emits a single default-text token for an empty line", () => {
        expect(tokenize("")).toEqual([{ startIndex: 0, foreground: TEXT, tokenType: StandardTokenType.Other }]);
    });

    it("colors known JS keywords with the keyword color", () => {
        const tokens = tokenize("if return const");
        expect(tokens[0]).toEqual({
            startIndex: 0,
            foreground: WordTokenColor.keyword,
            tokenType: StandardTokenType.Other,
        });
    });

    it("identifiers get the default color, unlike keywords", () => {
        expect(tokenize("foo")).toEqual([{ startIndex: 0, foreground: TEXT, tokenType: StandardTokenType.Other }]);
        expect(tokenize("if")[0].foreground).toBe(WordTokenColor.keyword);
    });

    it("recognises numeric literals", () => {
        expect(tokenize("123")).toEqual([
            { startIndex: 0, foreground: WordTokenColor.number, tokenType: StandardTokenType.Other },
        ]);
    });

    it("recognises double-quoted strings: string color and String token type", () => {
        expect(tokenize('"hello"')).toEqual([
            { startIndex: 0, foreground: WordTokenColor.string, tokenType: StandardTokenType.String },
        ]);
    });

    it("recognises single-quoted strings", () => {
        expect(tokenize("'hi'")[0]).toEqual({
            startIndex: 0,
            foreground: WordTokenColor.string,
            tokenType: StandardTokenType.String,
        });
    });

    it("treats `// ...` as a comment to end of line: comment color and Comment token type", () => {
        expect(tokenize("x // comment")).toEqual([
            { startIndex: 0, foreground: TEXT, tokenType: StandardTokenType.Other },
            { startIndex: 2, foreground: WordTokenColor.comment, tokenType: StandardTokenType.Comment },
        ]);
    });

    it("merges adjacent tokens with equal metadata", () => {
        // Identifiers, spaces and punctuation are all default text — one token.
        expect(tokenize("foo bar (baz)")).toEqual([
            { startIndex: 0, foreground: TEXT, tokenType: StandardTokenType.Other },
        ]);
        // Two keywords separated by a space are not adjacent — the space splits them.
        expect(tokenize("if return").map((t) => [t.startIndex, t.foreground])).toEqual([
            [0, WordTokenColor.keyword],
            [2, TEXT],
            [3, WordTokenColor.keyword],
        ]);
        // Adjacent strings merge too.
        expect(tokenize("'a''b'")).toHaveLength(1);
    });

    it("emits tokens with strictly increasing startIndex and alternating metadata", () => {
        const tokens = tokenize("if (x === 1) return null");
        for (let i = 1; i < tokens.length; i++) {
            expect(tokens[i].startIndex).toBeGreaterThan(tokens[i - 1].startIndex);
            expect(tokens[i]).not.toEqual({ ...tokens[i - 1], startIndex: tokens[i].startIndex });
        }
    });

    it("first token always starts at index 0", () => {
        const tokens = tokenize("   leading whitespace");
        expect(tokens[0].startIndex).toBe(0);
    });

    it("treats an escaped quote inside a string as part of the string token", () => {
        // The backslash escapes the inner quote, so the string does not terminate
        // until the final quote — the whole literal is one string token.
        const tokens = tokenize('"a\\"b" x');
        expect(tokens[0].foreground).toBe(WordTokenColor.string);

        // The text after the string only starts once it closes; if the escape
        // were mishandled the string would have ended early and the text would shift.
        expect(tokens[1]).toEqual({ startIndex: 6, foreground: TEXT, tokenType: StandardTokenType.Other });
    });

    it("skips an escaped backslash without ending the string early", () => {
        const tokens = tokenize("'a\\\\' 1");
        expect(tokens[0].foreground).toBe(WordTokenColor.string);

        const num = tokens.find((t) => t.foreground === WordTokenColor.number);
        expect(num).toBeDefined();
        expect(num!.startIndex).toBe(6);
    });

    it("treats digits inside an identifier as identifier parts, not numbers", () => {
        // The trailing/embedded digits are consumed by isIdentPart, so `foo2` and
        // `bar3baz` are identifiers — no number token is emitted.
        expect(tokenize("foo2 bar3baz")).toEqual([
            { startIndex: 0, foreground: TEXT, tokenType: StandardTokenType.Other },
        ]);
    });

    it("returns a fresh token array on every call (the pipeline converts it in place)", () => {
        const t = new WordTokenizer();
        const first = t.tokenizeEncoded("", false, t.getInitialState()).tokens;
        expect(t.tokenizeEncoded("", false, t.getInitialState()).tokens).not.toBe(first);
    });
});
