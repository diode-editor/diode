import { describe, expect, it } from "vitest";

import { createRange, type IRange } from "../core/iRange.ts";
import { createTextEdit } from "../core/iTextEdit.ts";

import { TextDocument } from "./textDocument.ts";
import { TrackedRangeStickiness } from "./trackedDecorations.ts";

type RangeTuple = readonly [number, number, number, number];

function toRange([startLine, startChar, endLine, endChar]: RangeTuple): IRange {
    return createRange(startLine, startChar, endLine, endChar);
}

const SAMPLE = ["My First Line", "My Second Line", "Third Line"].join("\n");

const STICKINESS = [
    TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges,
    TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
    TrackedRangeStickiness.GrowsOnlyWhenTypingBefore,
    TrackedRangeStickiness.GrowsOnlyWhenTypingAfter,
] as const;

function documentWithDecoration(
    decoration: RangeTuple,
    stickiness: TrackedRangeStickiness = TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
): { doc: TextDocument; id: string } {
    const doc = new TextDocument(SAMPLE);
    const [id] = doc.deltaDecorations(
        [],
        [{ range: toRange(decoration), options: { description: "test", stickiness } }],
    );
    return { doc, id };
}

function decorationAfterEdit(
    decoration: RangeTuple,
    stickiness: TrackedRangeStickiness,
    edit: RangeTuple,
    text: string,
): IRange | null {
    const { doc, id } = documentWithDecoration(decoration, stickiness);
    doc.applyEdits([createTextEdit(toRange(edit), text)]);
    return doc.getDecorationRange(id);
}

// Port of upstream suite "Decorations and editing" (`modelDecorations.test.ts`), 0-based.
// Expectations by stickiness: Always, Never, Before, After. No prettier — otherwise ~750 lines.
// prettier-ignore
const UPSTREAM_CASES: readonly (readonly [string, RangeTuple, RangeTuple, string, readonly RangeTuple[]])[] = [
    ["insert / collapsed dec / before", [0, 3, 0, 3], [0, 2, 0, 2], "xx", [[0, 5, 0, 5], [0, 5, 0, 5], [0, 5, 0, 5], [0, 5, 0, 5]]],
    ["insert / collapsed dec / equal", [0, 3, 0, 3], [0, 3, 0, 3], "xx", [[0, 3, 0, 5], [0, 5, 0, 5], [0, 3, 0, 3], [0, 5, 0, 5]]],
    ["insert / collapsed dec / after", [0, 3, 0, 3], [0, 4, 0, 4], "xx", [[0, 3, 0, 3], [0, 3, 0, 3], [0, 3, 0, 3], [0, 3, 0, 3]]],
    ["insert / non-collapsed dec / before", [0, 3, 0, 8], [0, 2, 0, 2], "xx", [[0, 5, 0, 10], [0, 5, 0, 10], [0, 5, 0, 10], [0, 5, 0, 10]]],
    ["insert / non-collapsed dec / start", [0, 3, 0, 8], [0, 3, 0, 3], "xx", [[0, 3, 0, 10], [0, 5, 0, 10], [0, 3, 0, 10], [0, 5, 0, 10]]],
    ["insert / non-collapsed dec / inside", [0, 3, 0, 8], [0, 4, 0, 4], "xx", [[0, 3, 0, 10], [0, 3, 0, 10], [0, 3, 0, 10], [0, 3, 0, 10]]],
    ["insert / non-collapsed dec / end", [0, 3, 0, 8], [0, 8, 0, 8], "xx", [[0, 3, 0, 10], [0, 3, 0, 8], [0, 3, 0, 8], [0, 3, 0, 10]]],
    ["insert / non-collapsed dec / after", [0, 3, 0, 8], [0, 9, 0, 9], "xx", [[0, 3, 0, 8], [0, 3, 0, 8], [0, 3, 0, 8], [0, 3, 0, 8]]],
    ["delete / collapsed dec / edit.end < range.start", [0, 3, 0, 3], [0, 0, 0, 2], "", [[0, 1, 0, 1], [0, 1, 0, 1], [0, 1, 0, 1], [0, 1, 0, 1]]],
    ["delete / collapsed dec / edit.end <= range.start", [0, 3, 0, 3], [0, 1, 0, 3], "", [[0, 1, 0, 1], [0, 1, 0, 1], [0, 1, 0, 1], [0, 1, 0, 1]]],
    ["delete / collapsed dec / edit.start < range.start && edit.end > range.end", [0, 3, 0, 3], [0, 2, 0, 4], "", [[0, 2, 0, 2], [0, 2, 0, 2], [0, 2, 0, 2], [0, 2, 0, 2]]],
    ["delete / collapsed dec / edit.start >= range.end", [0, 3, 0, 3], [0, 3, 0, 5], "", [[0, 3, 0, 3], [0, 3, 0, 3], [0, 3, 0, 3], [0, 3, 0, 3]]],
    ["delete / collapsed dec / edit.start > range.end", [0, 3, 0, 3], [0, 4, 0, 6], "", [[0, 3, 0, 3], [0, 3, 0, 3], [0, 3, 0, 3], [0, 3, 0, 3]]],
    ["delete / non-collapsed dec / edit.end < range.start", [0, 3, 0, 8], [0, 0, 0, 2], "", [[0, 1, 0, 6], [0, 1, 0, 6], [0, 1, 0, 6], [0, 1, 0, 6]]],
    ["delete / non-collapsed dec / edit.end <= range.start", [0, 3, 0, 8], [0, 1, 0, 3], "", [[0, 1, 0, 6], [0, 1, 0, 6], [0, 1, 0, 6], [0, 1, 0, 6]]],
    ["delete / non-collapsed dec / edit.start < range.start && edit.end < range.end", [0, 3, 0, 8], [0, 2, 0, 4], "", [[0, 2, 0, 6], [0, 2, 0, 6], [0, 2, 0, 6], [0, 2, 0, 6]]],
    ["delete / non-collapsed dec / edit.start < range.start && edit.end == range.end", [0, 3, 0, 8], [0, 2, 0, 8], "", [[0, 2, 0, 2], [0, 2, 0, 2], [0, 2, 0, 2], [0, 2, 0, 2]]],
    ["delete / non-collapsed dec / edit.start < range.start && edit.end > range.end", [0, 3, 0, 8], [0, 2, 0, 9], "", [[0, 2, 0, 2], [0, 2, 0, 2], [0, 2, 0, 2], [0, 2, 0, 2]]],
    ["delete / non-collapsed dec / edit.start == range.start && edit.end < range.end", [0, 3, 0, 8], [0, 3, 0, 5], "", [[0, 3, 0, 6], [0, 3, 0, 6], [0, 3, 0, 6], [0, 3, 0, 6]]],
    ["delete / non-collapsed dec / edit.start == range.start && edit.end == range.end", [0, 3, 0, 8], [0, 3, 0, 8], "", [[0, 3, 0, 3], [0, 3, 0, 3], [0, 3, 0, 3], [0, 3, 0, 3]]],
    ["delete / non-collapsed dec / edit.start == range.start && edit.end > range.end", [0, 3, 0, 8], [0, 3, 0, 9], "", [[0, 3, 0, 3], [0, 3, 0, 3], [0, 3, 0, 3], [0, 3, 0, 3]]],
    ["delete / non-collapsed dec / edit.start > range.start && edit.start < range.end && edit.end < range.end", [0, 3, 0, 8], [0, 4, 0, 6], "", [[0, 3, 0, 6], [0, 3, 0, 6], [0, 3, 0, 6], [0, 3, 0, 6]]],
    ["delete / non-collapsed dec / edit.start > range.start && edit.start < range.end && edit.end == range.end", [0, 3, 0, 8], [0, 4, 0, 8], "", [[0, 3, 0, 4], [0, 3, 0, 4], [0, 3, 0, 4], [0, 3, 0, 4]]],
    ["delete / non-collapsed dec / edit.start > range.start && edit.start < range.end && edit.end > range.end", [0, 3, 0, 8], [0, 4, 0, 9], "", [[0, 3, 0, 4], [0, 3, 0, 4], [0, 3, 0, 4], [0, 3, 0, 4]]],
    ["delete / non-collapsed dec / edit.start == range.end", [0, 3, 0, 8], [0, 8, 0, 10], "", [[0, 3, 0, 8], [0, 3, 0, 8], [0, 3, 0, 8], [0, 3, 0, 8]]],
    ["delete / non-collapsed dec / edit.start > range.end", [0, 3, 0, 8], [0, 9, 0, 10], "", [[0, 3, 0, 8], [0, 3, 0, 8], [0, 3, 0, 8], [0, 3, 0, 8]]],
    ["replace short / collapsed dec / edit.end < range.start", [0, 3, 0, 3], [0, 0, 0, 2], "c", [[0, 2, 0, 2], [0, 2, 0, 2], [0, 2, 0, 2], [0, 2, 0, 2]]],
    ["replace short / collapsed dec / edit.end <= range.start", [0, 3, 0, 3], [0, 1, 0, 3], "c", [[0, 2, 0, 2], [0, 2, 0, 2], [0, 2, 0, 2], [0, 2, 0, 2]]],
    ["replace short / collapsed dec / edit.start < range.start && edit.end > range.end", [0, 3, 0, 3], [0, 2, 0, 4], "c", [[0, 3, 0, 3], [0, 3, 0, 3], [0, 3, 0, 3], [0, 3, 0, 3]]],
    ["replace short / collapsed dec / edit.start >= range.end", [0, 3, 0, 3], [0, 3, 0, 5], "c", [[0, 3, 0, 3], [0, 3, 0, 3], [0, 3, 0, 3], [0, 3, 0, 3]]],
    ["replace short / collapsed dec / edit.start > range.end", [0, 3, 0, 3], [0, 4, 0, 6], "c", [[0, 3, 0, 3], [0, 3, 0, 3], [0, 3, 0, 3], [0, 3, 0, 3]]],
    ["replace short / non-collapsed dec / edit.end < range.start", [0, 3, 0, 8], [0, 0, 0, 2], "c", [[0, 2, 0, 7], [0, 2, 0, 7], [0, 2, 0, 7], [0, 2, 0, 7]]],
    ["replace short / non-collapsed dec / edit.end <= range.start", [0, 3, 0, 8], [0, 1, 0, 3], "c", [[0, 2, 0, 7], [0, 2, 0, 7], [0, 2, 0, 7], [0, 2, 0, 7]]],
    ["replace short / non-collapsed dec / edit.start < range.start && edit.end < range.end", [0, 3, 0, 8], [0, 2, 0, 4], "c", [[0, 3, 0, 7], [0, 3, 0, 7], [0, 3, 0, 7], [0, 3, 0, 7]]],
    ["replace short / non-collapsed dec / edit.start < range.start && edit.end == range.end", [0, 3, 0, 8], [0, 2, 0, 8], "c", [[0, 3, 0, 3], [0, 3, 0, 3], [0, 3, 0, 3], [0, 3, 0, 3]]],
    ["replace short / non-collapsed dec / edit.start < range.start && edit.end > range.end", [0, 3, 0, 8], [0, 2, 0, 9], "c", [[0, 3, 0, 3], [0, 3, 0, 3], [0, 3, 0, 3], [0, 3, 0, 3]]],
    ["replace short / non-collapsed dec / edit.start == range.start && edit.end < range.end", [0, 3, 0, 8], [0, 3, 0, 5], "c", [[0, 3, 0, 7], [0, 3, 0, 7], [0, 3, 0, 7], [0, 3, 0, 7]]],
    ["replace short / non-collapsed dec / edit.start == range.start && edit.end == range.end", [0, 3, 0, 8], [0, 3, 0, 8], "c", [[0, 3, 0, 4], [0, 3, 0, 4], [0, 3, 0, 4], [0, 3, 0, 4]]],
    ["replace short / non-collapsed dec / edit.start == range.start && edit.end > range.end", [0, 3, 0, 8], [0, 3, 0, 9], "c", [[0, 3, 0, 4], [0, 3, 0, 4], [0, 3, 0, 4], [0, 3, 0, 4]]],
    ["replace short / non-collapsed dec / edit.start > range.start && edit.start < range.end && edit.end < range.end", [0, 3, 0, 8], [0, 4, 0, 6], "c", [[0, 3, 0, 7], [0, 3, 0, 7], [0, 3, 0, 7], [0, 3, 0, 7]]],
    ["replace short / non-collapsed dec / edit.start > range.start && edit.start < range.end && edit.end == range.end", [0, 3, 0, 8], [0, 4, 0, 8], "c", [[0, 3, 0, 5], [0, 3, 0, 5], [0, 3, 0, 5], [0, 3, 0, 5]]],
    ["replace short / non-collapsed dec / edit.start > range.start && edit.start < range.end && edit.end > range.end", [0, 3, 0, 8], [0, 4, 0, 9], "c", [[0, 3, 0, 5], [0, 3, 0, 5], [0, 3, 0, 5], [0, 3, 0, 5]]],
    ["replace short / non-collapsed dec / edit.start == range.end", [0, 3, 0, 8], [0, 8, 0, 10], "c", [[0, 3, 0, 8], [0, 3, 0, 8], [0, 3, 0, 8], [0, 3, 0, 8]]],
    ["replace short / non-collapsed dec / edit.start > range.end", [0, 3, 0, 8], [0, 9, 0, 10], "c", [[0, 3, 0, 8], [0, 3, 0, 8], [0, 3, 0, 8], [0, 3, 0, 8]]],
    ["replace long / collapsed dec / edit.end < range.start", [0, 3, 0, 3], [0, 0, 0, 2], "cccc", [[0, 5, 0, 5], [0, 5, 0, 5], [0, 5, 0, 5], [0, 5, 0, 5]]],
    ["replace long / collapsed dec / edit.end <= range.start", [0, 3, 0, 3], [0, 1, 0, 3], "cccc", [[0, 3, 0, 5], [0, 5, 0, 5], [0, 3, 0, 3], [0, 5, 0, 5]]],
    ["replace long / collapsed dec / edit.start < range.start && edit.end > range.end", [0, 3, 0, 3], [0, 2, 0, 4], "cccc", [[0, 3, 0, 3], [0, 3, 0, 3], [0, 3, 0, 3], [0, 3, 0, 3]]],
    ["replace long / collapsed dec / edit.start >= range.end", [0, 3, 0, 3], [0, 3, 0, 5], "cccc", [[0, 3, 0, 3], [0, 3, 0, 3], [0, 3, 0, 3], [0, 3, 0, 3]]],
    ["replace long / collapsed dec / edit.start > range.end", [0, 3, 0, 3], [0, 4, 0, 6], "cccc", [[0, 3, 0, 3], [0, 3, 0, 3], [0, 3, 0, 3], [0, 3, 0, 3]]],
    ["replace long / non-collapsed dec / edit.end < range.start", [0, 3, 0, 8], [0, 0, 0, 2], "cccc", [[0, 5, 0, 10], [0, 5, 0, 10], [0, 5, 0, 10], [0, 5, 0, 10]]],
    ["replace long / non-collapsed dec / edit.end <= range.start", [0, 3, 0, 8], [0, 1, 0, 3], "cccc", [[0, 3, 0, 10], [0, 5, 0, 10], [0, 3, 0, 10], [0, 5, 0, 10]]],
    ["replace long / non-collapsed dec / edit.start < range.start && edit.end < range.end", [0, 3, 0, 8], [0, 2, 0, 4], "cccc", [[0, 3, 0, 10], [0, 3, 0, 10], [0, 3, 0, 10], [0, 3, 0, 10]]],
    ["replace long / non-collapsed dec / edit.start < range.start && edit.end == range.end", [0, 3, 0, 8], [0, 2, 0, 8], "cccc", [[0, 3, 0, 6], [0, 3, 0, 6], [0, 3, 0, 6], [0, 3, 0, 6]]],
    ["replace long / non-collapsed dec / edit.start < range.start && edit.end > range.end", [0, 3, 0, 8], [0, 2, 0, 9], "cccc", [[0, 3, 0, 6], [0, 3, 0, 6], [0, 3, 0, 6], [0, 3, 0, 6]]],
    ["replace long / non-collapsed dec / edit.start == range.start && edit.end < range.end", [0, 3, 0, 8], [0, 3, 0, 5], "cccc", [[0, 3, 0, 10], [0, 3, 0, 10], [0, 3, 0, 10], [0, 3, 0, 10]]],
    ["replace long / non-collapsed dec / edit.start == range.start && edit.end == range.end", [0, 3, 0, 8], [0, 3, 0, 8], "cccc", [[0, 3, 0, 7], [0, 3, 0, 7], [0, 3, 0, 7], [0, 3, 0, 7]]],
    ["replace long / non-collapsed dec / edit.start == range.start && edit.end > range.end", [0, 3, 0, 8], [0, 3, 0, 9], "cccc", [[0, 3, 0, 7], [0, 3, 0, 7], [0, 3, 0, 7], [0, 3, 0, 7]]],
    ["replace long / non-collapsed dec / edit.start > range.start && edit.start < range.end && edit.end < range.end", [0, 3, 0, 8], [0, 4, 0, 6], "cccc", [[0, 3, 0, 10], [0, 3, 0, 10], [0, 3, 0, 10], [0, 3, 0, 10]]],
    ["replace long / non-collapsed dec / edit.start > range.start && edit.start < range.end && edit.end == range.end", [0, 3, 0, 8], [0, 4, 0, 8], "cccc", [[0, 3, 0, 8], [0, 3, 0, 8], [0, 3, 0, 8], [0, 3, 0, 8]]],
    ["replace long / non-collapsed dec / edit.start > range.start && edit.start < range.end && edit.end > range.end", [0, 3, 0, 8], [0, 4, 0, 9], "cccc", [[0, 3, 0, 8], [0, 3, 0, 8], [0, 3, 0, 8], [0, 3, 0, 8]]],
    ["replace long / non-collapsed dec / edit.start == range.end", [0, 3, 0, 8], [0, 8, 0, 10], "cccc", [[0, 3, 0, 8], [0, 3, 0, 8], [0, 3, 0, 8], [0, 3, 0, 8]]],
    ["replace long / non-collapsed dec / edit.start > range.end", [0, 3, 0, 8], [0, 9, 0, 10], "cccc", [[0, 3, 0, 8], [0, 3, 0, 8], [0, 3, 0, 8], [0, 3, 0, 8]]],
];

describe("TrackedDecorations — upstream «Decorations and editing»", () => {
    for (const [name, decoration, edit, text, expected] of UPSTREAM_CASES) {
        it(name, () => {
            const actual = STICKINESS.map((stickiness) => decorationAfterEdit(decoration, stickiness, edit, text));
            expect(actual).toEqual(expected.map(toRange));
        });
    }
});

const SECOND: RangeTuple = [1, 3, 1, 9];

describe("TrackedDecorations: edits across lines", () => {
    it("inserting lines above moves the decoration down by their count", () => {
        expect(
            decorationAfterEdit(SECOND, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, [0, 0, 0, 0], "a\nb\n"),
        ).toEqual(createRange(3, 3, 3, 9));
    });

    it("line break left of the decoration moves it to the new line with a new column", () => {
        expect(
            decorationAfterEdit(SECOND, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, [1, 2, 1, 2], "\n  "),
        ).toEqual(createRange(2, 3, 2, 9));
    });

    it("joining with the previous line moves the decoration onto it with a column shift", () => {
        expect(
            decorationAfterEdit(SECOND, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, [0, 13, 1, 0], ""),
        ).toEqual(createRange(0, 16, 0, 22));
    });

    it("delete across lines covering the decoration collapses it to the edit start", () => {
        expect(
            decorationAfterEdit(SECOND, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, [0, 5, 2, 2], ""),
        ).toEqual(createRange(0, 5, 0, 5));
    });

    it("in the common part of a multiline replace an edge keeps its offset from the start", () => {
        // "Line\nMy Se" (10) → "ab\ncdefghij" (11): the start of "Second" stays the replacement's 7th char.
        expect(
            decorationAfterEdit(
                SECOND,
                TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
                [0, 10, 1, 5],
                "ab\ncdefghij",
            ),
        ).toEqual(createRange(1, 4, 1, 12));
    });

    it("edge on an old line after a multiline replace moves to the insert end", () => {
        // Edge (2,5) was on the edit's last line — it lands after "YZ" with its tail "ird".
        expect(
            decorationAfterEdit(
                [2, 0, 2, 5],
                TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
                [1, 10, 2, 2],
                "X\nYZ",
            ),
        ).toEqual(createRange(2, 2, 2, 5));
    });

    it("in the common part an edge at the end of a non-last inserted line stays on it", () => {
        // Same-length replace: the end of "First" stays at the end of the first inserted line, not the second's start.
        expect(
            decorationAfterEdit(
                [0, 3, 0, 8],
                TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
                [0, 0, 0, 13],
                "My First\nLine",
            ),
        ).toEqual(createRange(0, 3, 0, 8));
    });

    it("offset inside a replace also counts whole lines between its edges", () => {
        // 23 characters → 30 in one line: the start of "rd" stays the 21st char (3 + 1 + 14 + 1 + 2).
        expect(
            decorationAfterEdit(
                [2, 2, 2, 10],
                TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
                [0, 10, 2, 4],
                "abcdefghijklmnopqrstuvwxyz0123",
            ),
        ).toEqual(createRange(0, 31, 0, 46));
    });

    it("start of a multiline decoration one line above the edit stays in place", () => {
        expect(
            decorationAfterEdit(
                [0, 3, 2, 5],
                TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
                [1, 3, 1, 9],
                "Secund",
            ),
        ).toEqual(createRange(0, 3, 2, 5));
    });

    it("edit batch moves the decoration by each edit", () => {
        const { doc, id } = documentWithDecoration([2, 6, 2, 10]);
        doc.applyEdits([createTextEdit(createRange(0, 0, 0, 0), "X\n"), createTextEdit(createRange(2, 0, 2, 0), "yy")]);
        expect(doc.getDecorationRange(id)).toEqual(createRange(3, 8, 3, 12));
        expect(doc.getTextInRange(createRange(3, 8, 3, 12))).toBe("Line");
    });

    it("undo is a plain edit: the decoration moves back with the text", () => {
        const { doc, id } = documentWithDecoration(SECOND);
        const { inverseEdits } = doc.applyEdits([createTextEdit(createRange(0, 0, 0, 0), "a\n")]);
        doc.applyEdits(inverseEdits);
        expect(doc.getDecorationRange(id)).toEqual(toRange(SECOND));
    });
});

describe("TrackedDecorations: lifecycle", () => {
    it("edges grow when typing at them by default (AlwaysGrowsWhenTypingAtEdges)", () => {
        const doc = new TextDocument(SAMPLE);
        const [id] = doc.deltaDecorations([], [{ range: createRange(0, 3, 0, 8), options: { description: "test" } }]);
        doc.applyEdits([createTextEdit(createRange(0, 3, 0, 3), "xx")]);
        expect(doc.getDecorationRange(id)).toEqual(createRange(0, 3, 0, 10));
    });

    it("delta removes old ids and returns new ones in decoration order", () => {
        const { doc, id } = documentWithDecoration(SECOND);
        const ids = doc.deltaDecorations(
            [id],
            [
                { range: createRange(0, 0, 0, 2), options: { description: "a" } },
                { range: createRange(2, 0, 2, 5), options: { description: "b" } },
            ],
        );
        expect(doc.getDecorationRange(id)).toBeNull();
        expect(ids.map((newId) => doc.getDecorationRange(newId))).toEqual([
            createRange(0, 0, 0, 2),
            createRange(2, 0, 2, 5),
        ]);
        expect(new Set([id, ...ids]).size).toBe(3);
    });

    it("range outside the document is clamped to it on add", () => {
        const doc = new TextDocument(SAMPLE);
        const [id] = doc.deltaDecorations([], [{ range: createRange(1, 10, 7, 40), options: { description: "test" } }]);
        expect(doc.getDecorationRange(id)).toEqual(createRange(1, 10, 2, 10));
    });

    it("setText keeps decorations at their old coordinates, clamped to the new text", () => {
        const { doc, id } = documentWithDecoration(SECOND);
        doc.setText("short");
        expect(doc.getDecorationRange(id)).toEqual(createRange(0, 3, 0, 5));
    });

    it("edit below the decoration leaves it alone", () => {
        expect(
            decorationAfterEdit(SECOND, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, [2, 0, 2, 5], ""),
        ).toEqual(toRange(SECOND));
    });
});
