import { describe, expect, it } from "vitest";

import { stringHash } from "./hash.ts";

describe("stringHash", () => {
    it("seeds the empty string and folds in every char code as hashVal * 31 + code, as int32", () => {
        expect(stringHash("", 0)).toBe(149417);
        expect(stringHash("a", 0)).toBe(149417 * 31 + 97);
        expect(stringHash("hello", 0)).toBe(-6409527);
    });

    it("depends on the initial value, so a collision can be rehashed", () => {
        expect(stringHash("hello", 1)).toBe(881094154);
        expect(stringHash("", 2 ** 30)).toBe((((2 ** 30) << 5) - 2 ** 30 + 149417) | 0);
    });
});
