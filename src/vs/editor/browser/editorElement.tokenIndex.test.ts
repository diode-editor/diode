import { describe, expect, it } from "vitest";

import { createLineTokens, createToken } from "../common/languages/iLineTokens.ts";

import { TokenIndex } from "./tokenIndex.ts";

describe("TokenIndex", () => {
    const tokens = createLineTokens([createToken(0, ["a"]), createToken(5, ["b"]), createToken(10, ["c"])]);

    it("returns undefined when there are no tokens", () => {
        const index = new TokenIndex(createLineTokens([]), 10);
        expect(index.tokenAt(0)).toBeUndefined();
    });

    it("returns undefined for an offset at or past the line length", () => {
        const index = new TokenIndex(tokens, 15);
        expect(index.tokenAt(15)).toBeUndefined();
    });

    it("finds the covering token on a forward scan", () => {
        const index = new TokenIndex(tokens, 15);
        expect(index.tokenAt(0)?.scopes).toEqual(["a"]);
        expect(index.tokenAt(7)?.scopes).toEqual(["b"]);
        expect(index.tokenAt(12)?.scopes).toEqual(["c"]);
    });

    it("rewinds the internal cursor when an offset moves backwards", () => {
        const index = new TokenIndex(tokens, 15);
        // Advance the cursor to the last token...
        expect(index.tokenAt(12)?.scopes).toEqual(["c"]);
        // ...then query an earlier offset: the cursor (at the "c" token, whose
        // startIndex 10 > 2) must rewind to 0 before scanning forward again.
        expect(index.tokenAt(2)?.scopes).toEqual(["a"]);
    });
});
