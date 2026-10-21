import { describe, expect, it } from "vitest";

import { charMask, fuzzyMatchBest, fuzzyMatchPrepared, fuzzyMatchPreparedLower, prepareQuery } from "./fuzzySearch.ts";

function match(query: string, text: string): ReturnType<typeof fuzzyMatchPrepared> {
    return fuzzyMatchPrepared(prepareQuery(query), text);
}

/** Match score; null turns into NaN so a comparison can't pass silently. */
function score(query: string, text: string): number {
    return match(query, text)?.score ?? Number.NaN;
}

describe("prepareQuery — terms", () => {
    it("a query without spaces is one term", () => {
        expect(prepareQuery("panel").terms).toEqual(["panel"]);
    });

    it("a space separates terms", () => {
        expect(prepareQuery("toggle panel").terms).toEqual(["toggle", "panel"]);
    });

    it("terms are lowercased", () => {
        expect(prepareQuery("Toggle PANEL").terms).toEqual(["toggle", "panel"]);
    });

    it("an empty query gives no terms", () => {
        expect(prepareQuery("").terms).toEqual([]);
    });

    it("a whitespace-only query gives no terms — the list does not go blank", () => {
        expect(prepareQuery("   ").terms).toEqual([]);
    });

    it("consecutive spaces are not separate terms", () => {
        expect(prepareQuery("go  line").terms).toEqual(["go", "line"]);
    });

    it("leading and trailing spaces do not become terms", () => {
        expect(prepareQuery(" go line ").terms).toEqual(["go", "line"]);
    });

    it("a tab is a separator just like a space", () => {
        expect(prepareQuery("go\tline").terms).toEqual(["go", "line"]);
    });
});

describe("prepareQuery — character mask", () => {
    it("the mask is the union of the term masks", () => {
        expect(prepareQuery("go line").bits).toBe(charMask("goline"));
    });

    it("a space is not in the mask: it is a separator, not a searched character", () => {
        expect(prepareQuery("go line").bits).not.toBe(charMask("go line"));
        expect(prepareQuery("go line").bits & charMask(" ")).toBe(0);
    });

    it("an empty query has an empty mask", () => {
        expect(prepareQuery("  ").bits).toBe(0);
    });

    it("the mask is a necessary match condition: text without a term character fails", () => {
        const query = prepareQuery("src other");
        expect(charMask("src/main.ts") & query.bits).not.toBe(query.bits);
        expect(charMask("src/other.ts") & query.bits).toBe(query.bits);
    });
});

describe("fuzzyMatchPrepared — every term must match", () => {
    it("a space is not searched for literally in the text", () => {
        expect(match("src other", "src/other.ts")).not.toBeNull();
        expect(fuzzyMatchBest("src other", "src/other.ts")).toBeNull();
    });

    it("terms match in any order relative to the text", () => {
        expect(match("other src", "src/other.ts")).not.toBeNull();
    });

    it("an unmatched term rejects the whole entry", () => {
        expect(match("src missing", "src/other.ts")).toBeNull();
    });

    it("no term matched gives null", () => {
        expect(match("zzz qqq", "src/other.ts")).toBeNull();
    });

    it("text with a space is still found by a two-term query", () => {
        expect(match("file one", "file one.txt")).not.toBeNull();
    });

    it("`go line` finds 'Go to Line/Column...'", () => {
        expect(match("go line", "Go to Line/Column...")).not.toBeNull();
    });

    it("`toggle panel` finds 'View: Toggle Panel Visibility'", () => {
        expect(match("toggle panel", "View: Toggle Panel Visibility")).not.toBeNull();
    });

    it("a trailing space does not blank anything", () => {
        expect(match("go line ", "Go to Line/Column...")).not.toBeNull();
    });
});

describe("fuzzyMatchPrepared — empty query", () => {
    it("matches everything with zero score and no highlights", () => {
        expect(match("", "anything")).toEqual({ score: 0, matchedIndices: [] });
    });

    it("a whitespace-only query behaves like an empty one", () => {
        expect(match("   ", "anything")).toEqual({ score: 0, matchedIndices: [] });
    });

    it("an empty query matches even empty text", () => {
        expect(match("", "")).toEqual({ score: 0, matchedIndices: [] });
    });
});

describe("fuzzyMatchPrepared — a single term is indistinguishable from fuzzyMatchBest", () => {
    const cases: [string, string][] = [
        ["ac", "AppContainer"],
        ["fss", "FileSearchService.ts"],
        ["src", "src/Controls/FileSearchService.ts"],
        ["zz", "AppContainer"],
        ["az", "aaaaaaaaaaaaz"],
    ];

    it("scores and indices match exactly", () => {
        for (const [query, text] of cases) {
            expect(match(query, text)).toEqual(fuzzyMatchBest(query, text));
        }
    });

    it("the ranking 'AC' → AppContainer above abstract holds", () => {
        expect(score("ac", "AppContainer")).toBeGreaterThan(score("ac", "abstract"));
    });
});

describe("fuzzyMatchPrepared — scoring", () => {
    it("scores add up across terms", () => {
        const text = "Go to Line/Column...";
        expect(score("go line", text)).toBe(score("go", text) + score("line", text));
    });

    it("the word boundary bonus stays: a space in the TEXT is still a boundary", () => {
        // `panel` after a space beats `anel` inside a word of the same length.
        expect(score("toggle panel", "Toggle Panel")).toBeGreaterThan(score("toggle anel", "Toggle Xanel"));
    });

    it("a match at word boundaries beats a match in the middle", () => {
        expect(score("go line", "Go Line")).toBeGreaterThan(score("go line", "ago xxline"));
    });
});

describe("fuzzyMatchPrepared — match indices", () => {
    it("term indices merge into one ascending set", () => {
        expect(match("src other", "src/other.ts")?.matchedIndices).toEqual([0, 1, 2, 4, 5, 6, 7, 8]);
    });

    it("out-of-order terms still come back ascending", () => {
        expect(match("other src", "src/other.ts")?.matchedIndices).toEqual([0, 1, 2, 4, 5, 6, 7, 8]);
    });

    it("a position covered by two terms enters the set once", () => {
        // `ab` → 0,1; `ba` → 1,2. Index 1 is shared.
        expect(match("ab ba", "aba")?.matchedIndices).toEqual([0, 1, 2]);
    });

    it("fully identical terms do not duplicate indices", () => {
        expect(match("ab ab", "ab")?.matchedIndices).toEqual([0, 1]);
    });
});

describe("fuzzyMatchPreparedLower — parity with the wrapper", () => {
    const cases: [string, string][] = [
        ["src other", "src/Other.ts"],
        ["ac", "AppContainer"],
        ["go line", "Go to Line/Column..."],
        ["zz qq", "AppContainer"],
        ["", "anything"],
    ];

    it("with pre-lowercased text the result is the same", () => {
        for (const [query, text] of cases) {
            const prepared = prepareQuery(query);
            expect(fuzzyMatchPreparedLower(prepared, text, text.toLowerCase())).toEqual(
                fuzzyMatchPrepared(prepared, text),
            );
        }
    });

    it("word boundaries are computed from the original text case", () => {
        const prepared = prepareQuery("a c");
        const camel = fuzzyMatchPreparedLower(prepared, "AppContainer", "appcontainer");
        const flat = fuzzyMatchPreparedLower(prepared, "appxcontainer", "appxcontainer");
        expect(camel).not.toBeNull();
        expect(flat).not.toBeNull();
        expect(camel!.score).toBeGreaterThan(flat!.score);
    });
});
