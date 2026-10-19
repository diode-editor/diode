import { describe, expect, it } from "vitest";

import type { ILineTokens } from "../languages/iLineTokens.ts";
import { createLineTokens, createToken } from "../languages/iLineTokens.ts";

import { ContiguousMultilineTokensBuilder } from "./contiguousMultilineTokensBuilder.ts";

const tokens = (scope: string): ILineTokens => createLineTokens([createToken(0, [scope])]);

describe("ContiguousMultilineTokensBuilder", () => {
    it("подряд идущие строки сливает в один блок, разрыв начинает новый", () => {
        const builder = new ContiguousMultilineTokensBuilder();
        builder.add(3, tokens("a"));
        builder.add(4, tokens("b"));
        builder.add(7, tokens("c"));

        const blocks = builder.finalize();
        expect(blocks.map((b) => [b.startLineNumber, b.endLineNumber])).toEqual([
            [3, 4],
            [7, 7],
        ]);
        expect(blocks[0].getLineTokens(3)).toEqual(tokens("a"));
        expect(blocks[0].getLineTokens(4)).toEqual(tokens("b"));
        expect(blocks[1].getLineTokens(7)).toEqual(tokens("c"));
    });

    it("та же строка ещё раз — новый блок, а не дописывание", () => {
        const builder = new ContiguousMultilineTokensBuilder();
        builder.add(5, tokens("a"));
        builder.add(5, tokens("b"));
        expect(builder.finalize()).toHaveLength(2);
    });
});
