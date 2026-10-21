import { describe, expect, it } from "vitest";

import { createMatchers, type Matcher } from "./textMateScopeMatcher.ts";

/**
 * Matcher input is a set of names; an identifier name matches if present in the input,
 * and the weight is the (1-based) index of the last found path identifier.
 */
function matchesName(names: readonly string[], input: readonly string[]): number {
    let score = -1;
    for (const name of names) {
        const index = input.indexOf(name);
        if (index === -1) return -1;
        score = index + 1;
    }
    return score;
}

function compile(selector: string): Matcher<readonly string[]>[] {
    const results: Matcher<readonly string[]>[] = [];
    createMatchers(selector, matchesName, results);
    return results;
}

function scores(selector: string, input: readonly string[]): number[] {
    return compile(selector).map((matcher) => matcher(input));
}

describe("createMatchers", () => {
    it("a single scope and a space-separated scope path", () => {
        expect(scores("a", ["x", "a"])).toEqual([2]);
        expect(scores("a b", ["a", "b"])).toEqual([2]);
        expect(scores("a b", ["b"])).toEqual([-1]);
    });

    it("a top-level comma gives separate matchers for alternatives", () => {
        expect(scores("a, b", ["b"])).toEqual([-1, 1]);
    });

    it("negation: a match gives -1, a mismatch gives 0", () => {
        expect(scores("-a", ["a"])).toEqual([-1]);
        expect(scores("-a", ["b"])).toEqual([0]);
        expect(scores("b -a", ["b"])).toEqual([0]);
        expect(scores("b -a", ["b", "a"])).toEqual([-1]);
    });

    it("a conjunction is the minimum, and the first miss short-circuits it", () => {
        expect(scores("a b c", ["c", "b", "a"])).toEqual([1]);
        expect(scores("a z b", ["a", "b"])).toEqual([-1]);
    });

    it("parentheses: disjunction via `|` and `,` is the maximum, consecutive separators collapse", () => {
        expect(scores("(a | b)", ["b"])).toEqual([1]);
        expect(scores("(a , , b)", ["x", "a"])).toEqual([2]);
        expect(scores("(a | b)", ["c"])).toEqual([-1]);
        expect(scores("(a | b) c", ["a", "c"])).toEqual([1]);
        expect(scores("(a | b", ["b"])).toEqual([1]);
        expect(scores("(a) b", ["a", "b"])).toEqual([1]);
    });

    it("L:/R: priorities are skipped", () => {
        expect(scores("L:a, R:b", ["a", "b"])).toEqual([1, 2]);
    });

    it("empty and broken selectors give no matchers", () => {
        expect(compile("")).toEqual([]);
        expect(compile("-")).toEqual([]);
        expect(compile("()")).toEqual([]);
        expect(compile("|")).toEqual([]);
    });

    it("after an invalid alternative parsing stops without a comma", () => {
        expect(scores("a ) b", ["a", "b"])).toEqual([1]);
    });

    it("a priority is only a two-character token with a colon; the rest are identifiers", () => {
        expect(scores("ab", ["ab"])).toEqual([1]);
        expect(scores("abc:", ["abc:"])).toEqual([1]);
    });

    it("double negation: a mismatch of the inner one gives -1", () => {
        expect(scores("- -a", ["x"])).toEqual([-1]);
        expect(scores("- -a", ["a"])).toEqual([0]);
    });

    it("after a parenthesis the conjunction continues: a missing operand is a miss", () => {
        expect(scores("(a) b", ["a"])).toEqual([-1]);
    });

    it("a zero negation weight does not short-circuit the conjunction: the next miss fails it", () => {
        expect(scores("-a (b)", ["x"])).toEqual([-1]);
    });

    it("inside parentheses both alternatives, via `,` and via a repeated `|`", () => {
        expect(scores("(a , b)", ["b"])).toEqual([1]);
        expect(scores("(a | | b)", ["b"])).toEqual([1]);
    });

    it("an identifier allows dots, colons and hyphens inside", () => {
        expect(scores("meta.tag-name:x", ["meta.tag-name:x"])).toEqual([1]);
    });
});
