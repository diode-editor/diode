import { describe, expect, it } from "vitest";

import { collectWordCompletions } from "./collectWordCompletions.ts";

describe("collectWordCompletions", () => {
    it("collects unique words in order of first appearance", () => {
        expect(collectWordCompletions(["foo bar foo baz"], "")).toEqual(["foo", "bar", "baz"]);
    });

    it("excludes the typed prefix and short (<2) words", () => {
        expect(collectWordCompletions(["ind indent a bb ind"], "ind")).toEqual(["indent", "bb"]);
    });

    it("merges several texts with deduplication", () => {
        expect(collectWordCompletions(["alpha beta", "beta gamma"], "")).toEqual(["alpha", "beta", "gamma"]);
    });

    it("ignores non-identifier characters and leading digits", () => {
        expect(collectWordCompletions(["a1 = 12; _x.y-z"], "")).toEqual(["a1", "_x"]);
    });

    it("collects words of any alphabet, not only ASCII", () => {
        // "fyva privet_2 naive 1test"
        expect(
            collectWordCompletions(
                ["\u0444\u044b\u0432\u0430 \u043f\u0440\u0438\u0432\u0435\u0442_2 naïve 1\u0442\u0435\u0441\u0442"],
                "",
            ),
        ).toEqual([
            "\u0444\u044b\u0432\u0430", // "fyva"
            "\u043f\u0440\u0438\u0432\u0435\u0442_2", // "privet_2"
            "naïve",
            "\u0442\u0435\u0441\u0442", // "test"
        ]);
    });

    it("skips documents above the size limit (large file protection)", () => {
        const big = "word ".repeat(500); // > the limit below
        expect(collectWordCompletions([big, "small tiny"], "", { maxBytesPerText: 100 })).toEqual(["small", "tiny"]);
    });

    it("caps the number of words", () => {
        const words = collectWordCompletions(["aa bb cc dd ee"], "", { maxWords: 3 });
        expect(words).toEqual(["aa", "bb", "cc"]);
    });
});
