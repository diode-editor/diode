import { describe, expect, it } from "vitest";

import {
    DEFAULT_LARGE_FILE_OPTIONS,
    isTooLargeForTokenization,
    LARGE_FILE_LINE_COUNT_THRESHOLD,
    LARGE_FILE_SIZE_THRESHOLD_MB,
    MiB,
} from "./largeFileOptions.ts";

describe("isTooLargeForTokenization", () => {
    const sizeLimit = LARGE_FILE_SIZE_THRESHOLD_MB * MiB;

    it("upstream defaults: 20 MB of characters or 300K lines, strictly above", () => {
        expect(LARGE_FILE_SIZE_THRESHOLD_MB).toBe(20);
        expect(LARGE_FILE_LINE_COUNT_THRESHOLD).toBe(300_000);
        expect(isTooLargeForTokenization(sizeLimit, 1, DEFAULT_LARGE_FILE_OPTIONS)).toBe(false);
        expect(isTooLargeForTokenization(sizeLimit + 1, 1, DEFAULT_LARGE_FILE_OPTIONS)).toBe(true);
        expect(isTooLargeForTokenization(1, LARGE_FILE_LINE_COUNT_THRESHOLD, DEFAULT_LARGE_FILE_OPTIONS)).toBe(false);
        expect(isTooLargeForTokenization(1, LARGE_FILE_LINE_COUNT_THRESHOLD + 1, DEFAULT_LARGE_FILE_OPTIONS)).toBe(
            true,
        );
    });

    it("either axis alone is enough", () => {
        const options = { largeFileOptimizations: true, sizeThresholdMb: 1, lineCountThreshold: 10 };
        expect(isTooLargeForTokenization(MiB + 1, 1, options)).toBe(true);
        expect(isTooLargeForTokenization(1, 11, options)).toBe(true);
        expect(isTooLargeForTokenization(MiB, 10, options)).toBe(false);
    });

    it("with the optimizations off nothing is too large", () => {
        const options = { ...DEFAULT_LARGE_FILE_OPTIONS, largeFileOptimizations: false };
        expect(isTooLargeForTokenization(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, options)).toBe(false);
    });
});
