import { describe, expect, it } from "vitest";

import { markedMetadata, storedTokens } from "../../../../TestUtils/encodedTokens.ts";

import { ContiguousMultilineTokensBuilder } from "./contiguousMultilineTokensBuilder.ts";

const tokens = (n: number): Uint32Array => storedTokens([[0, markedMetadata(n)]], 1);

describe("ContiguousMultilineTokensBuilder", () => {
    it("merges consecutive lines into one block, a gap starts a new one", () => {
        const builder = new ContiguousMultilineTokensBuilder();
        builder.add(3, tokens(11));
        builder.add(4, tokens(12));
        builder.add(7, tokens(13));

        const blocks = builder.finalize();
        expect(blocks.map((b) => [b.startLineNumber, b.endLineNumber])).toEqual([
            [3, 4],
            [7, 7],
        ]);
        expect(blocks[0].getLineTokens(3)).toEqual(tokens(11));
        expect(blocks[0].getLineTokens(4)).toEqual(tokens(12));
        expect(blocks[1].getLineTokens(7)).toEqual(tokens(13));
    });

    it("same line again starts a new block instead of appending", () => {
        const builder = new ContiguousMultilineTokensBuilder();
        builder.add(5, tokens(11));
        builder.add(5, tokens(12));
        expect(builder.finalize()).toHaveLength(2);
    });

    it("serialize/deserialize keeps blocks and line tokens", () => {
        const builder = new ContiguousMultilineTokensBuilder();
        builder.add(3, tokens(11));
        builder.add(
            4,
            storedTokens(
                [
                    [0, markedMetadata(12)],
                    [2, markedMetadata(14)],
                ],
                5,
            ),
        );
        builder.add(9, tokens(13));

        const blocks = ContiguousMultilineTokensBuilder.deserialize(builder.serialize());
        expect(blocks.map((b) => [b.startLineNumber, b.endLineNumber])).toEqual([
            [3, 4],
            [9, 9],
        ]);
        expect(blocks[0].getLineTokens(3)).toEqual(tokens(11));
        expect(blocks[0].getLineTokens(4)).toEqual(
            storedTokens(
                [
                    [0, markedMetadata(12)],
                    [2, markedMetadata(14)],
                ],
                5,
            ),
        );
        expect(blocks[1].getLineTokens(9)).toEqual(tokens(13));
    });
});
