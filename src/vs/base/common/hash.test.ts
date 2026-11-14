import { describe, expect, it } from "vitest";

import { numberHash, stringHash } from "./hash.ts";

describe("hash", () => {
    it("numberHash is hashVal * 31 + val as int32", () => {
        expect(numberHash(5, 7)).toBe(7 * 31 + 5);
        expect(numberHash(1, 2 ** 30)).toBe((2 ** 30 * 31 + 1) | 0);
    });

    it("stringHash seeds the empty string and folds in every char code", () => {
        expect(stringHash("", 0)).toBe(149417);
        expect(stringHash("a", 0)).toBe(numberHash(97, 149417));
        expect(stringHash("hello", 0)).toBe(-6409527);
    });

    it("stringHash depends on the initial value, so a collision can be rehashed", () => {
        expect(stringHash("hello", 1)).toBe(881094154);
        expect(stringHash("hello", 1)).not.toBe(stringHash("hello", 0));
    });
});
