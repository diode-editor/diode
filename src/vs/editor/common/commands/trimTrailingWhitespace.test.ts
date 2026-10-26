import { describe, expect, it } from "vitest";

import { createRange } from "../core/iRange.ts";
import { StandardTokenType } from "../encodedTokenAttributes.ts";
import type { LineTokens } from "../tokens/lineTokens.ts";

import {
    type ITrimWhitespaceTokens,
    trailingWhitespaceStart,
    trimTrailingWhitespaceRanges,
} from "./trimTrailingWhitespace.ts";

/** One token type per line, starting at the given offset; before it everything is code. */
function tokens(
    byLine: Record<number, { from: number; type: StandardTokenType } | "inaccurate">,
): ITrimWhitespaceTokens & { asked: number[] } {
    const asked: number[] = [];
    const specs = new Map(Object.entries(byLine).map(([line, spec]) => [Number(line), spec]));
    return {
        asked,
        hasAccurateTokensForLine: (line) => specs.get(line) !== "inaccurate",
        getLineTokens: (line) => {
            const spec = specs.get(line);
            if (spec === "inaccurate") return undefined;
            return {
                findTokenIndexAtOffset: (offset: number) => {
                    asked.push(offset);
                    return spec !== undefined && offset >= spec.from ? 1 : 0;
                },
                getStandardTokenType: (index: number) =>
                    index === 1 && spec !== undefined ? spec.type : StandardTokenType.Other,
            } as unknown as LineTokens;
        },
    };
}

describe("trailingWhitespaceStart", () => {
    it("stops at the first character that is not a space or a tab", () => {
        expect(trailingWhitespaceStart("ab \t ")).toBe(2);
        expect(trailingWhitespaceStart("ab")).toBe(2);
        expect(trailingWhitespaceStart(" \t")).toBe(0);
        expect(trailingWhitespaceStart("")).toBe(0);
    });

    it("other Unicode spaces are content", () => {
        expect(trailingWhitespaceStart("a ")).toBe(2);
        expect(trailingWhitespaceStart("a  ")).toBe(2);
    });
});

describe("trimTrailingWhitespaceRanges", () => {
    it("deletes the space/tab tail of every line; whitespace-only lines become empty", () => {
        expect(trimTrailingWhitespaceRanges(["a  ", "b", "\t \t", "", "c\t"], true, undefined)).toEqual([
            createRange(0, 1, 0, 3),
            createRange(2, 0, 2, 3),
            createRange(4, 1, 4, 2),
        ]);
    });

    it("trimInRegexAndStrings on: tokens are not consulted", () => {
        const store = tokens({ 0: { from: 0, type: StandardTokenType.String } });
        expect(trimTrailingWhitespaceRanges(["a  "], true, store)).toEqual([createRange(0, 1, 0, 3)]);
        expect(store.asked).toEqual([]);
    });

    it("trimInRegexAndStrings off: a tail starting in a String or RegEx token is kept, code and comments are trimmed", () => {
        const store = tokens({
            0: { from: 1, type: StandardTokenType.String },
            1: { from: 1, type: StandardTokenType.RegEx },
            2: { from: 1, type: StandardTokenType.Comment },
            3: { from: 5, type: StandardTokenType.String },
        });
        expect(trimTrailingWhitespaceRanges(["a  ", "b  ", "c  ", "d  "], false, store)).toEqual([
            createRange(2, 1, 2, 3),
            createRange(3, 1, 3, 3),
        ]);
        // The type is looked up at the start of the tail.
        expect(store.asked).toEqual([1, 1, 1, 1]);
    });

    it("trimInRegexAndStrings off: lines without accurate tokens, and everything without a store, are skipped", () => {
        const store = tokens({ 0: "inaccurate" });
        expect(trimTrailingWhitespaceRanges(["a  ", "b  "], false, store)).toEqual([createRange(1, 1, 1, 3)]);
        expect(trimTrailingWhitespaceRanges(["a  ", "b  "], false, undefined)).toEqual([]);
    });

    it("trimInRegexAndStrings off: accurate tokens but none cached for the line skip it", () => {
        const store: ITrimWhitespaceTokens = {
            hasAccurateTokensForLine: () => true,
            getLineTokens: () => undefined,
        };
        expect(trimTrailingWhitespaceRanges(["a  "], false, store)).toEqual([]);
    });
});
