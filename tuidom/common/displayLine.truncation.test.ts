import { describe, expect, it } from "vitest";

import { DisplayLine } from "./displayLine.ts";

describe("DisplayLine — stopAfter truncation", () => {
    it("default stopAfter (Infinity) never truncates", () => {
        const dl = new DisplayLine("a".repeat(50_000));
        expect(dl.isTruncated).toBe(false);
        expect(dl.displayWidth).toBe(50_000);
        expect(dl.slots.length).toBe(50_000);
    });

    it("does not truncate when the line is shorter than the cap", () => {
        const dl = new DisplayLine("hello", 4, 10);
        expect(dl.isTruncated).toBe(false);
        expect(dl.displayWidth).toBe(5);
        expect(dl.slots.length).toBe(5);
    });

    it("does not truncate when the line exactly fills the cap", () => {
        const dl = new DisplayLine("abcde", 4, 5);
        expect(dl.isTruncated).toBe(false);
        expect(dl.displayWidth).toBe(5);
    });

    it("truncates to the prefix and flags isTruncated", () => {
        const dl = new DisplayLine("abcdefghij", 4, 4);
        expect(dl.isTruncated).toBe(true);
        expect(dl.slots.length).toBe(4);
        expect(dl.displayWidth).toBe(4);
        expect(dl.charAtColumn(0)).toBe("a");
        expect(dl.charAtColumn(3)).toBe("d");
        // Nothing rendered past the prefix.
        expect(dl.charAtColumn(4)).toBe(" ");
    });

    it("offsets past the cap clamp to displayWidth (cursor sticks at the marker)", () => {
        const dl = new DisplayLine("abcdefghij", 4, 4);
        expect(dl.offsetToColumn(2)).toBe(2);
        expect(dl.offsetToColumn(4)).toBe(4);
        expect(dl.offsetToColumn(9)).toBe(4);
        expect(dl.offsetToColumn(1_000)).toBe(4);
    });

    it("never allocates past the scanned prefix for an extreme line", () => {
        // A 1M-char line capped at 10 must behave like a 10-char line, not
        // allocate a 1M-entry columnMap. We can only observe the prefix here.
        const dl = new DisplayLine("x".repeat(1_000_000), 4, 10);
        expect(dl.isTruncated).toBe(true);
        expect(dl.slots.length).toBe(10);
        expect(dl.displayWidth).toBe(10);
        expect(dl.columnToOffset(10)).toBe(10);
    });

    it("cuts on a grapheme boundary, never mid-cluster", () => {
        // Each 😀 is a 2-code-unit surrogate pair rendered 2 cols wide.
        // A grapheme is kept iff its start offset < cap. Cap 2 keeps only the
        // first emoji (2nd starts at index 2), never a half surrogate pair.
        const dl = new DisplayLine("😀😀😀", 4, 2);
        expect(dl.isTruncated).toBe(true);
        expect(dl.slots.length).toBe(1);
        expect(dl.slots[0].grapheme).toBe("😀");
        expect(dl.displayWidth).toBe(2);
    });
});
