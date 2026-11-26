import { describe, expect, it } from "vitest";

import { isRecursiveWatchPattern } from "./watchPattern.ts";

describe("isRecursiveWatchPattern", () => {
    it("a single-segment pattern matches direct children only", () => {
        expect(isRecursiveWatchPattern("*")).toBe(false);
        expect(isRecursiveWatchPattern("HEAD")).toBe(false);
    });

    it("a globstar or a separator matches the subtree", () => {
        expect(isRecursiveWatchPattern("**")).toBe(true);
        expect(isRecursiveWatchPattern("**/*.ts")).toBe(true);
        expect(isRecursiveWatchPattern("src/*.ts")).toBe(true);
    });
});
