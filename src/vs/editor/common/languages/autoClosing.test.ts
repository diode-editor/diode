import { describe, expect, it } from "vitest";

import { findSurroundingPair, planAutoClose } from "./autoClosing.ts";
import type { IResolvedAutoClosingPair } from "./languageConfiguration.ts";
import { DEFAULT_AUTO_CLOSE_BEFORE } from "./languageConfiguration.ts";

const PAIRS: IResolvedAutoClosingPair[] = [
    { open: "{", close: "}", notIn: [] },
    { open: "(", close: ")", notIn: [] },
    { open: "'", close: "'", notIn: [] },
    { open: "/**", close: " */", notIn: [] },
];

function plan(
    typedChar: string,
    lineContent: string,
    column: number,
    pairs = PAIRS,
    before = DEFAULT_AUTO_CLOSE_BEFORE,
) {
    return planAutoClose({ typedChar, lineContent, column, autoClosingPairs: pairs, autoCloseBefore: before });
}

describe("planAutoClose — pair insertion", () => {
    it("an opening char at line end yields a pair", () => {
        expect(plan("{", "const a = ", 10)).toEqual({ kind: "autoClose", close: "}" });
    });

    it("an opening char before a character from autoCloseBefore yields a pair", () => {
        expect(plan("(", "call;", 4)).toEqual({ kind: "autoClose", close: ")" });
        expect(plan("{", "a }", 2)).toEqual({ kind: "autoClose", close: "}" });
    });

    it("an opening char in the middle of a word is NOT closed", () => {
        expect(plan("{", "word", 2)).toEqual({ kind: "plain" });
        expect(plan("(", "foo bar", 4)).toEqual({ kind: "plain" });
    });

    it("an unpaired character is typed as usual", () => {
        expect(plan("x", "", 0)).toEqual({ kind: "plain" });
    });

    it("a multi-char opening matches the text tail up to the cursor", () => {
        // `/**` is longer than `(`/`{`: typing `*` after `/*` appends ` */`.
        expect(plan("*", "/*", 2)).toEqual({ kind: "autoClose", close: " */" });
        expect(plan("*", "a", 1)).toEqual({ kind: "plain" });
    });

    it("among several matching openings the longest wins, in any order", () => {
        const overlapping = [
            { open: "ab", close: "X", notIn: [] },
            { open: "b", close: "Y", notIn: [] },
        ];
        // Long declared before short: the short one does NOT override it.
        expect(plan("b", "a", 1, overlapping)).toEqual({ kind: "autoClose", close: "X" });
        // And the reverse: long declared later overrides the short one.
        expect(plan("b", "a", 1, [...overlapping].reverse())).toEqual({ kind: "autoClose", close: "X" });
    });

    it("a bracket after a word character at line end closes (the rule applies to quotes only)", () => {
        expect(plan("{", "foo", 3)).toEqual({ kind: "autoClose", close: "}" });
    });

    it("the line tail AFTER the cursor is not part of the opening search", () => {
        expect(plan("*", ";/*", 0)).toEqual({ kind: "plain" });
    });

    it("a multi-char symmetric pair is exempt from the not-after-a-word rule", () => {
        const triple = [{ open: '"""', close: '"""', notIn: [] }];
        expect(plan('"', 'a""', 3, triple)).toEqual({ kind: "autoClose", close: '"""' });
    });

    it("among equal-length openings the first declared wins", () => {
        const duplicates = [
            { open: "a", close: "X", notIn: [] },
            { open: "a", close: "Y", notIn: [] },
        ];
        expect(plan("a", "", 0, duplicates)).toEqual({ kind: "autoClose", close: "X" });
    });

    it("a custom autoCloseBefore narrows the context", () => {
        expect(plan("{", "a;", 1, PAIRS, ";")).toEqual({ kind: "autoClose", close: "}" });
        expect(plan("{", "a)", 1, PAIRS, ";")).toEqual({ kind: "plain" });
    });
});

describe("planAutoClose — quotes (symmetric pairs)", () => {
    it("a quote in empty space opens a pair", () => {
        expect(plan("'", "a = ", 4)).toEqual({ kind: "autoClose", close: "'" });
    });

    it("a quote at line start opens a pair (nothing to the left)", () => {
        expect(plan("'", "", 0)).toEqual({ kind: "autoClose", close: "'" });
    });

    it("a quote after a word character is an apostrophe, not a pair (don't)", () => {
        expect(plan("'", "don", 3)).toEqual({ kind: "plain" });
    });

    it("a quote after the same quote is not doubled", () => {
        expect(plan("'", "' ", 1, PAIRS, " ")).toEqual({ kind: "plain" });
    });
});

describe("planAutoClose — typeover", () => {
    it("typing a closing char already under the cursor steps over it", () => {
        expect(plan("}", "{}", 1)).toEqual({ kind: "typeover" });
        expect(plan(")", "f()", 2)).toEqual({ kind: "typeover" });
        expect(plan("'", "''", 1)).toEqual({ kind: "typeover" });
    });

    it("typeover beats auto-closing for quotes", () => {
        const decision = plan("'", "''", 1);
        expect(decision.kind).toBe("typeover");
    });

    it("a character that is not a closing one is not stepped over", () => {
        expect(plan("x", "x", 0)).toEqual({ kind: "plain" });
    });

    it("another character under the cursor — a plain pair insertion or typing", () => {
        expect(plan("}", "{a", 1)).toEqual({ kind: "plain" });
    });
});

describe("findSurroundingPair", () => {
    const SURROUND = [
        ["{", "}"],
        ["'", "'"],
    ] as const;

    it("finds the pair by its opening", () => {
        expect(findSurroundingPair("{", SURROUND)).toEqual(["{", "}"]);
        expect(findSurroundingPair("'", SURROUND)).toEqual(["'", "'"]);
    });

    it("a character outside pairs — undefined", () => {
        expect(findSurroundingPair("}", SURROUND)).toBeUndefined();
        expect(findSurroundingPair("x", SURROUND)).toBeUndefined();
    });
});
