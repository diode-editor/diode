import { describe, expect, it, vi } from "vitest";

import { safeIntl } from "./date.ts";
import { Lazy } from "./lazy.ts";

/** Consumer: the vendored `core/wordCharacterClassifier.ts`. */

describe("Lazy", () => {
    it("computes the value once — on the first read", () => {
        const executor = vi.fn(() => 42);
        const lazy = new Lazy(executor);
        expect(executor).not.toHaveBeenCalled();
        expect(lazy.hasValue).toBe(false);
        expect(lazy.rawValue).toBeUndefined();

        expect(lazy.value).toBe(42);
        expect(lazy.value).toBe(42);
        expect(executor).toHaveBeenCalledTimes(1);
        expect(lazy.hasValue).toBe(true);
        expect(lazy.rawValue).toBe(42);
    });

    it("a computation error is rethrown on every read without calling again", () => {
        const failure = new Error("boom");
        const executor = vi.fn((): number => {
            throw failure;
        });
        const lazy = new Lazy(executor);
        expect(() => lazy.value).toThrow(failure);
        expect(() => lazy.value).toThrow(failure);
        expect(executor).toHaveBeenCalledTimes(1);
        expect(lazy.hasValue).toBe(true);
    });

    it("reading from inside its own computation is an error", () => {
        const holder: { lazy?: Lazy<number> } = {};
        const lazy = new Lazy<number>(() => (holder.lazy?.value ?? 0) + 1);
        holder.lazy = lazy;
        expect(() => lazy.value).toThrow("Cannot read the value of a lazy that is being initialized");
    });
});

describe("safeIntl.Segmenter", () => {
    it("creates the segmenter lazily and splits into words", () => {
        const segmenter = safeIntl.Segmenter(["en"], { granularity: "word" });
        expect(segmenter.hasValue).toBe(false);
        const words = [...segmenter.value.segment("hello world")].filter((s) => s.isWordLike).map((s) => s.segment);
        expect(words).toEqual(["hello", "world"]);
    });

    it("falls back to the default locale on a broken locale", () => {
        const segmenter = safeIntl.Segmenter(["not a locale!"], { granularity: "grapheme" });
        expect([...segmenter.value.segment("ab")].map((s) => s.segment)).toEqual(["a", "b"]);
    });
});
