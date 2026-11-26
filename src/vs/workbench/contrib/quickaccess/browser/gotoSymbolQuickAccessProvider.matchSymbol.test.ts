import { describe, expect, it } from "vitest";

import { matchSymbol } from "./gotoSymbolQuickAccessProvider.ts";

function ranked(query: string, names: readonly string[]): string[] {
    return names
        .map((name) => ({ name, score: matchSymbol(name, "", query)?.score ?? -Infinity }))
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.name);
}

describe("matchSymbol — ranking", () => {
    it("the exact name, then a prefix, then a scattered match with word starts", () => {
        expect(ranked("Hello", ["heldLockInfo", "HelloWorld", "Hello"])).toEqual([
            "Hello",
            "HelloWorld",
            "heldLockInfo",
        ]);
    });

    it("compares names without regard to case", () => {
        expect(ranked("hello", ["heldLockInfo", "HELLO"])).toEqual(["HELLO", "heldLockInfo"]);
    });

    it("a query that is not a prefix gets no bonus", () => {
        expect(matchSymbol("aHello", "", "hello")?.score).toBeLessThan(matchSymbol("Hello", "", "hello")?.score ?? 0);
        expect(matchSymbol("nothing", "", "hello")).toBeNull();
    });
});
