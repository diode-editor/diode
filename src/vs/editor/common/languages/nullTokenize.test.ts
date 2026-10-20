import { describe, expect, it } from "vitest";

import { LineTokens } from "../tokens/lineTokens.ts";

import { createLineTokens, createToken } from "./iLineTokens.ts";
import { NULL_STATE } from "./iState.ts";
import { nullTokenizeEncoded } from "./nullTokenize.ts";

describe("nullTokenizeEncoded", () => {
    it("один токен без скоупов на всю строку, состояние то же", () => {
        const result = nullTokenizeEncoded(0, NULL_STATE);
        expect(result.tokens).toEqual(createLineTokens([createToken(0, [])]));
        expect(result.endState).toBe(NULL_STATE);
    });
});

describe("LineTokens.convertToEndOffset", () => {
    it("наши токены не трогает: концы в них не хранятся", () => {
        const lineTokens = createLineTokens([createToken(0, ["a"]), createToken(3, ["b"])]);
        LineTokens.convertToEndOffset(lineTokens, 10);
        expect(lineTokens).toEqual(createLineTokens([createToken(0, ["a"]), createToken(3, ["b"])]));
    });
});
