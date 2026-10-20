import { describe, expect, it } from "vitest";

import { markedMetadata, storedTokens } from "../../../TestUtils/encodedTokens.ts";
import type { ILanguageIdCodec } from "../common/languages.ts";
import { LineTokens } from "../common/tokens/lineTokens.ts";

import { TokenIndex } from "./tokenIndex.ts";

const codec: ILanguageIdCodec = {
    encodeLanguageId: () => 0,
    decodeLanguageId: () => "plaintext",
};

const TEXT = "aaaaabbbbbccccc";
const A = markedMetadata(3);
const B = markedMetadata(4);
const C = markedMetadata(5);

describe("TokenIndex", () => {
    const tokens = new LineTokens(
        storedTokens(
            [
                [0, A],
                [5, B],
                [10, C],
            ],
            TEXT.length,
        ),
        TEXT,
        codec,
    );

    it("returns undefined when there are no tokens", () => {
        const index = new TokenIndex(new LineTokens(new Uint32Array(0), "", codec), 10);
        expect(index.metadataAt(0)).toBeUndefined();
    });

    it("returns undefined for an offset at or past the line length", () => {
        const index = new TokenIndex(tokens, 15);
        expect(index.metadataAt(15)).toBeUndefined();
    });

    it("finds the covering token on a forward scan", () => {
        const index = new TokenIndex(tokens, 15);
        expect(index.metadataAt(0)).toBe(A);
        expect(index.metadataAt(7)).toBe(B);
        expect(index.metadataAt(12)).toBe(C);
    });

    it("rewinds the internal cursor when an offset moves backwards", () => {
        const index = new TokenIndex(tokens, 15);
        // Advance the cursor to the last token...
        expect(index.metadataAt(12)).toBe(C);
        // ...then query an earlier offset: the cursor (at the "c" token, whose
        // start 10 > 2) must rewind to 0 before scanning forward again.
        expect(index.metadataAt(2)).toBe(A);
    });
});
