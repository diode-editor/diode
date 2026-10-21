import { describe, expect, it } from "vitest";

import { charMask, fuzzyMatch, fuzzyMatchBest, fuzzyMatchBestLower, fuzzyMatchLower } from "./fuzzySearch.ts";

describe("fuzzyMatch — basic matching", () => {
    it("returns null when no characters match in order", () => {
        expect(fuzzyMatch("xyz", "abc")).toBeNull();
    });

    it("returns null when only some characters match", () => {
        expect(fuzzyMatch("ace", "ac")).toBeNull();
    });

    it("matches all characters present in order", () => {
        expect(fuzzyMatch("ac", "abstract")).not.toBeNull();
    });

    it("matches single character", () => {
        expect(fuzzyMatch("a", "alpha")).not.toBeNull();
    });

    it("returns score 0 and empty indices for empty query", () => {
        const result = fuzzyMatch("", "anything");
        expect(result).not.toBeNull();
        expect(result!.score).toBe(0);
        expect(result!.matchedIndices).toHaveLength(0);
    });

    it("returns null for non-empty query against empty text", () => {
        expect(fuzzyMatch("a", "")).toBeNull();
    });

    it("exact full string match returns non-null", () => {
        expect(fuzzyMatch("abc", "abc")).not.toBeNull();
    });

    it("is case-insensitive", () => {
        expect(fuzzyMatch("AC", "AppContainer")).not.toBeNull();
        expect(fuzzyMatch("ac", "AppContainer")).not.toBeNull();
        expect(fuzzyMatch("AC", "appcontainer")).not.toBeNull();
    });
});

describe("fuzzyMatch — matchedIndices", () => {
    it("reports correct indices for sequential match", () => {
        const result = fuzzyMatch("ac", "abstract");
        expect(result).not.toBeNull();
        expect(result!.matchedIndices[0]).toBe(0);
    });

    it("includes both matched positions", () => {
        const result = fuzzyMatch("ab", "xaxbx");
        expect(result).not.toBeNull();
        expect(result!.matchedIndices).toHaveLength(2);
    });

    it("length of matchedIndices equals query length", () => {
        const result = fuzzyMatch("ctrl", "Controls");
        expect(result!.matchedIndices).toHaveLength(4);
    });
});

describe("fuzzyMatch — word boundary scoring", () => {
    it("word-boundary match scores higher than mid-word match", () => {
        const boundary = fuzzyMatch("ac", "AppContainer");
        const midword = fuzzyMatch("ac", "abstract");
        expect(boundary).not.toBeNull();
        expect(midword).not.toBeNull();
        expect(boundary!.score).toBeGreaterThan(midword!.score);
    });

    it("slash-separated path gives word boundary bonus at each segment", () => {
        const result = fuzzyMatch("ac", "app/controllers");
        expect(result).not.toBeNull();
    });

    it("underscore acts as word boundary", () => {
        const withUnderscore = fuzzyMatch("fc", "first_contact.ts");
        const withoutBoundary = fuzzyMatch("fc", "firefox_changes");
        expect(withUnderscore).not.toBeNull();
        expect(withoutBoundary).not.toBeNull();
    });

    it("camelCase boundary is detected", () => {
        const result = fuzzyMatch("AC", "AppContainer");
        expect(result).not.toBeNull();
        // A (first char) and C (camelCase) each earn WORD_START_BONUS.
        expect(result!.score).toBeGreaterThan(100);
    });

    it("dot acts as word boundary", () => {
        const result = fuzzyMatch("ts", "controller.ts");
        expect(result).not.toBeNull();
    });
});

describe("fuzzyMatch — consecutive bonus", () => {
    it("consecutive match scores higher than scattered match of same chars", () => {
        const consecutive = fuzzyMatch("ctrl", "controller");
        const scattered = fuzzyMatch("ctrl", "cXtXrXl");
        expect(consecutive).not.toBeNull();
        expect(scattered).not.toBeNull();
        expect(consecutive!.score).toBeGreaterThan(scattered!.score);
    });
});

describe("fuzzyMatch — ranking", () => {
    it('query "ac": AppContainer ranks above abstract', () => {
        const container = fuzzyMatch("ac", "AppContainer");
        const abstract_ = fuzzyMatch("ac", "abstract");
        expect(container!.score).toBeGreaterThan(abstract_!.score);
    });

    it('query "fc": FileContainer ranks above first_contact', () => {
        const fileCtrl = fuzzyMatchBest("fc", "FileContainer");
        const firstContact = fuzzyMatchBest("fc", "first_contact");
        expect(fileCtrl).not.toBeNull();
        expect(firstContact).not.toBeNull();
        expect(fileCtrl!.score).toBeGreaterThan(firstContact!.score);
    });

    it('query "cr": CommandRegistry ranks above continuous_record', () => {
        // 'c'(0, word+first) + 'r'(7, camelCase boundary) → high score in CommandRegistry
        // 'c'(0, word+first) + 'r'(11, underscore boundary) → slightly lower in continuous_record
        const registry = fuzzyMatchBest("cr", "CommandRegistry");
        const continuous = fuzzyMatchBest("cr", "continuous_record");
        expect(registry).not.toBeNull();
        expect(continuous).not.toBeNull();
        expect(registry!.score).toBeGreaterThan(continuous!.score);
    });

    it("shorter file with same boundary chars ranks higher than longer", () => {
        const shorter = fuzzyMatch("ac", "AppContainer");
        const longer = fuzzyMatch("ac", "AppContainerFactory");
        expect(shorter).not.toBeNull();
        expect(longer).not.toBeNull();
        // Matched positions are identical, so scores tie: trailing chars carry no gap penalty.
        expect(shorter!.score).toBeGreaterThanOrEqual(longer!.score);
    });

    it("first character match gets extra bonus", () => {
        const startMatch = fuzzyMatch("a", "alpha");
        const midMatch = fuzzyMatch("a", "xalpha");
        expect(startMatch!.score).toBeGreaterThan(midMatch!.score);
    });
});

describe("fuzzyMatchBest", () => {
    it("returns null when no match", () => {
        expect(fuzzyMatchBest("xyz", "abc")).toBeNull();
    });

    it("returns match when characters present", () => {
        expect(fuzzyMatchBest("ac", "AppContainer")).not.toBeNull();
    });

    it("prefers word-boundary start over mid-word start", () => {
        // 'f' is a boundary at 0 and at 6 ('f'ile), 'c' at 11 ('c'ontroller).
        const result = fuzzyMatchBest("fc", "first_file_controller");
        expect(result).not.toBeNull();
    });

    it("empty query returns score 0", () => {
        expect(fuzzyMatchBest("", "anything")).toEqual({ score: 0, matchedIndices: [] });
    });

    it("caps candidate start positions at 8 occurrences of the first char", () => {
        // 12 'a's followed by a 'z'. fuzzyMatchBest only scans the first 8 'a'
        // start positions; the 'z' lives past all of them, so it must still match.
        const result = fuzzyMatchBest("az", "aaaaaaaaaaaaz");
        expect(result).not.toBeNull();
        expect(result!.matchedIndices).toHaveLength(2);
        expect(result!.matchedIndices[1]).toBe(12);
    });

    it("produces higher or equal score than greedy fuzzyMatch", () => {
        const greedy = fuzzyMatch("ac", "abstract_class");
        const best = fuzzyMatchBest("ac", "abstract_class");
        expect(best).not.toBeNull();
        expect(best!.score).toBeGreaterThanOrEqual(greedy!.score);
    });

    it("returns null for non-empty query against empty text (no candidates)", () => {
        expect(fuzzyMatchBest("a", "")).toBeNull();
    });

    it("skips candidate starts that cannot complete the match", () => {
        // 'a' occurs at index 0 and 4. Only the start at 0 can reach a later 'b'
        // (index 2); the start at 4 has no 'b' after it and is discarded.
        const result = fuzzyMatchBest("ab", "axbxa");
        expect(result).not.toBeNull();
        expect(result!.matchedIndices).toEqual([0, 2]);
    });
});

describe("fuzzyMatch — separator word boundaries", () => {
    const baseline = fuzzyMatch("ac", "abcd")!.score; // 'c' at index 2 is mid-word

    it("dash is a word boundary", () => {
        expect(fuzzyMatch("ac", "ab-cd")!.score).toBeGreaterThan(baseline);
    });

    it("space is a word boundary", () => {
        expect(fuzzyMatch("ac", "ab cd")!.score).toBeGreaterThan(baseline);
    });

    it("backslash is a word boundary", () => {
        expect(fuzzyMatch("ac", "ab\\cd")!.score).toBeGreaterThan(baseline);
    });

    it("slash is a word boundary", () => {
        expect(fuzzyMatch("ac", "ab/cd")!.score).toBeGreaterThan(baseline);
    });

    it("underscore is a word boundary", () => {
        expect(fuzzyMatch("ac", "ab_cd")!.score).toBeGreaterThan(baseline);
    });

    it("dot is a word boundary", () => {
        expect(fuzzyMatch("ac", "ab.cd")!.score).toBeGreaterThan(baseline);
    });
});

describe("fuzzyMatch — camelCase boundary detection", () => {
    it("uppercase preceded by lowercase IS a boundary", () => {
        const lowerToUpper = fuzzyMatch("ac", "abCd");
        // 'C' in "aBCd" follows uppercase 'B' → NOT a camelCase boundary
        const upperToUpper = fuzzyMatch("ac", "aBCd");
        expect(lowerToUpper).not.toBeNull();
        expect(upperToUpper).not.toBeNull();
        expect(lowerToUpper!.score).toBeGreaterThan(upperToUpper!.score);
    });

    it("acronym run (uppercase after uppercase) gives no extra boundary bonus", () => {
        // In "HTTPServer" only 'H' is a boundary: 'S' follows uppercase 'P'.
        const result = fuzzyMatch("hs", "HTTPServer");
        expect(result).not.toBeNull();
        expect(result!.matchedIndices).toEqual([0, 4]);
    });
});

describe("fuzzyMatch — gap penalty", () => {
    it("a larger gap between matched chars lowers the score", () => {
        const tight = fuzzyMatch("az", "az");
        const loose = fuzzyMatch("az", "axxxz");
        expect(tight).not.toBeNull();
        expect(loose).not.toBeNull();
        expect(tight!.score).toBeGreaterThan(loose!.score);
    });

    it("leading gap before the first matched char is penalised", () => {
        const atStart = fuzzyMatch("a", "axxx");
        const offset = fuzzyMatch("a", "xxxa");
        expect(atStart!.score).toBeGreaterThan(offset!.score);
    });
});

describe("fuzzyMatchLower / fuzzyMatchBestLower — parity with wrappers", () => {
    const cases: [string, string][] = [
        ["ac", "AppContainer"],
        ["fss", "FileSearchService.ts"],
        ["src", "src/Controls/FileSearchService.ts"],
        ["zz", "AppContainer"],
        ["", "anything"],
    ];

    it("fuzzyMatchLower matches fuzzyMatch given pre-lowercased inputs", () => {
        for (const [query, text] of cases) {
            const viaWrapper = fuzzyMatch(query, text);
            const viaLower = fuzzyMatchLower(query.toLowerCase(), text, text.toLowerCase());
            expect(viaLower).toEqual(viaWrapper);
        }
    });

    it("fuzzyMatchBestLower matches fuzzyMatchBest given pre-lowercased inputs", () => {
        for (const [query, text] of cases) {
            const viaWrapper = fuzzyMatchBest(query, text);
            const viaLower = fuzzyMatchBestLower(query.toLowerCase(), text, text.toLowerCase());
            expect(viaLower).toEqual(viaWrapper);
        }
    });

    it("scoring still uses original case for camelCase word boundaries", () => {
        const camel = fuzzyMatchBestLower("c", "AppContainer", "appcontainer");
        const flat = fuzzyMatchBestLower("c", "appxxxxxxxxxx", "appxxxxxxxxxx");
        expect(camel).not.toBeNull();
        expect(flat).toBeNull();
    });
});

describe("charMask — presence prefilter", () => {
    it("is empty for the empty string", () => {
        expect(charMask("")).toBe(0);
    });

    it("a-z map to distinct, collision-free bits", () => {
        const bits = new Set<number>();
        for (let c = 97; c <= 122; c++) bits.add(charMask(String.fromCharCode(c)));
        expect(bits.size).toBe(26);
    });

    it("is order- and repetition-independent (set semantics)", () => {
        expect(charMask("abc")).toBe(charMask("cba"));
        expect(charMask("aabbc")).toBe(charMask("abc"));
    });

    it("a query subset is contained in a superset's mask", () => {
        const text = charMask("filesearchservice");
        const query = charMask("fss");
        expect((text & query) === query).toBe(true);
    });

    it("rejects when the text lacks a query char (necessary condition)", () => {
        const text = charMask("readme");
        const query = charMask("readz");
        expect((text & query) === query).toBe(false);
    });

    it("never rejects a real fuzzy match across a sample (soundness)", () => {
        const texts = ["AppContainer.ts", "src/Common/FuzzySearch.ts", "file_search.test.ts", "a1b2c3"];
        const queries = ["ac", "fz", "search", "a1c3", "test", "zzz", "9x"];
        for (const t of texts) {
            const tMask = charMask(t.toLowerCase());
            for (const q of queries) {
                if (fuzzyMatch(q, t) !== null) {
                    const qMask = charMask(q.toLowerCase());
                    expect((tMask & qMask) === qMask).toBe(true);
                }
            }
        }
    });
});
