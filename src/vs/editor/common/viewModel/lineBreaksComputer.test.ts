import { describe, expect, it } from "vitest";

import type { IInlineInsertion } from "../model/iInlineInsertion.ts";

import { computeComposedLineBreakOffsets, computeLineBreakOffsets, MIN_WRAP_WIDTH } from "./lineBreaksComputer.ts";
import { STOP_RENDERING_LINE_AFTER } from "./longLineRendering.ts";

describe("computeLineBreakOffsets — basic cases", () => {
    it("a line that fits the width does not wrap (null)", () => {
        expect(computeLineBreakOffsets("hello", 4, 10)).toBeNull();
        expect(computeLineBreakOffsets("", 4, 10)).toBeNull();
        expect(
            computeLineBreakOffsets("\u0430\u0431\u0432\u0433\u0434\u0435\u0435\u0436\u0437\u0438", 4, 10),
        ).toBeNull(); // "abvgdeezhzi": 10 narrow non-ASCII chars
    });

    it("wraps at a word boundary: the space stays at the tail of the previous fragment", () => {
        // "aaaa bbbb " (10 columns) + "cccc": the first one that doesn't fit is c.
        expect(computeLineBreakOffsets("aaaa bbbb cccc", 4, 10)).toEqual([10]);
    });

    it("wrap after a whitespace RUN: all spaces hang on the first fragment", () => {
        // "aa" + 6 spaces = 8 columns, word b starts right past the width.
        expect(computeLineBreakOffsets("aa      bbbbbbbb", 4, 8)).toEqual([8]);
    });

    it("a word longer than the width is hard-cut at a grapheme boundary", () => {
        expect(computeLineBreakOffsets("abcdefghijklmnop", 4, 8)).toEqual([8]);
    });

    it("several wraps: both at words and a hard cut of a long word", () => {
        // "aaaa " + 20×b, width 8: word wrap at 5, then b is cut every 8.
        expect(computeLineBreakOffsets(`aaaa ${"b".repeat(20)}`, 4, 8)).toEqual([5, 13, 21]);
    });

    it("trailing spaces create no wraps and no empty fragments", () => {
        expect(computeLineBreakOffsets("aaaaaaaa    ", 4, 8)).toBeNull();
    });

    it("tabs count by columns (tab stops), the wrap goes after the tab", () => {
        // tab (4 columns) + "aaaa" = 8 columns; "bbb" doesn't fit → wrap after the whitespace run.
        expect(computeLineBreakOffsets("\taaaa bbb", 4, 8)).toEqual([6]);
    });
});

describe("computeLineBreakOffsets — wide characters and CJK", () => {
    it("CJK without spaces is cut at graphemes, a wide pair is not split", () => {
        // 5 ideographs of 2 columns each = 10 > 8; 4 fit (8 columns).
        expect(computeLineBreakOffsets("字字字字字", 4, 8)).toEqual([4]);
    });

    it("a wide character at the boundary is not split — the fragment is one column shorter", () => {
        // Width 9: four 字 take 8, the fifth (10) doesn't fit whole.
        expect(computeLineBreakOffsets("字字字字字", 4, 9)).toEqual([4]);
    });

    it("a wrap at a candidate after which the word still does not fit — double cut", () => {
        // " a字字字字": ws(0) a(1) 字×4 (cols 2..10). The last 字 (cols 8-10)
        // overflows width 8 twice: a wrap at the candidate (after ws) and a hard cut.
        expect(computeLineBreakOffsets(" a字字字字", 4, 8)).toEqual([1, 5]);
    });
});

describe("computeLineBreakOffsets — clamps and thresholds", () => {
    it("width clamps from below to MIN_WRAP_WIDTH", () => {
        // With the honest width 1 a word would be cut per character; the clamp cuts every 8.
        expect(computeLineBreakOffsets("abcdefghijklmnop", 4, 1)).toEqual([MIN_WRAP_WIDTH]);
    });

    it("a single slot wider than the width (giant tab) is not cut and does not loop", () => {
        // A tab at tabSize=16 is wider than the clamp of 8, but a tab is whitespace: no wrap is created.
        expect(computeLineBreakOffsets("\t\t", 16, 8)).toBeNull();
    });

    it("the tail past STOP_RENDERING_LINE_AFTER is not scanned", () => {
        const breaks = computeLineBreakOffsets("x".repeat(STOP_RENDERING_LINE_AFTER + 5000), 4, 50);
        expect(breaks).not.toBeNull();
        // The parsed prefix (10,000) yields exactly 199 cuts of 50 columns…
        expect(breaks).toHaveLength(STOP_RENDERING_LINE_AFTER / 50 - 1);
        // …and none past the threshold.
        expect(breaks?.at(-1)).toBe(STOP_RENDERING_LINE_AFTER - 50);
    });
});

describe("computeComposedLineBreakOffsets — wrapping with insertions", () => {
    const at = (offset: number, text: string): IInlineInsertion => ({ line: 0, offset, text });

    it("a line that fits only without its insertion wraps", () => {
        expect(computeLineBreakOffsets("aaaa bbbb", 4, 10)).toBeNull();
        expect(computeComposedLineBreakOffsets("aaaa bbbb", [at(4, ": int")], 4, 10)).toEqual([5]);
    });

    it("a line whose insertion still fits does not wrap", () => {
        expect(computeComposedLineBreakOffsets("aaaa", [at(4, ": int")], 4, 10)).toBeNull();
    });

    it("breaks are document offsets, past every insertion before them", () => {
        // Composed "f(a=1, b=2, 3333333)". The space before "b=" is no break, so the cut is at the "," that overflows:
        // composed offset 10, document offset 6 with both labels out.
        const breaks = computeComposedLineBreakOffsets("f(1, 2, 3333333)", [at(2, "a="), at(5, "b=")], 4, 10);
        expect(breaks).toEqual([6]);
    });

    it("a break never lands right before an insertion: its cells would overflow the fragment before", () => {
        // Composed "aaaaaaaa" + "bb" + "cc": the overflow is inside the insertion, the cut goes before the last "a".
        expect(computeComposedLineBreakOffsets("aaaaaaaacc", [at(8, "bb")], 4, 8)).toEqual([7]);
    });

    it("a break right after an insertion keeps it on the fragment before", () => {
        // Composed "aaaaaa" + "bb" + "cccc": exactly 8 columns up to the end of the insertion.
        expect(computeComposedLineBreakOffsets("aaaaaacccc", [at(6, "bb")], 4, 8)).toEqual([6]);
    });

    it("an insertion at the line start never yields an empty first fragment", () => {
        expect(computeComposedLineBreakOffsets("abcdefgh", [at(0, "12345678")], 4, 8)).toEqual([1]);
    });

    it("an insertion wider than the width overflows instead of looping", () => {
        expect(computeComposedLineBreakOffsets("ab", [at(1, "123456789012")], 4, 8)).toEqual([1]);
    });
});
