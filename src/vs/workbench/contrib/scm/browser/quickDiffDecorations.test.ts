import { describe, expect, it } from "vitest";

import { DefaultLinesDiffComputer } from "../../../../editor/common/diff/defaultLinesDiffComputer/defaultLinesDiffComputer.ts";

import type { IQuickDiffColors } from "./quickDiffDecorations.ts";
import { toGutterDecorations } from "./quickDiffDecorations.ts";

/**
 * Expectations are taken from runs of the real engine, not from reading the code: the test catches
 * both a conversion bug and a change in engine behavior when the pin is bumped.
 */

const COLORS: IQuickDiffColors = { added: 0x00ff00, modified: 0x0000ff, deleted: 0xff0000 };

function gutter(original: string[], modified: string[]) {
    const diff = new DefaultLinesDiffComputer().computeDiff(original, modified, {
        ignoreTrimWhitespace: false,
        maxComputationTimeMs: Number.MAX_SAFE_INTEGER,
        computeMoves: false,
    });
    return toGutterDecorations(diff.changes, COLORS).map((d) => ({
        lines: [d.range.start.line, d.range.end.line],
        color: d.color,
        dashed: d.dashed === true,
    }));
}

describe("toGutterDecorations", () => {
    it("identical texts: no bars", () => {
        expect(gutter(["a", "b"], ["a", "b"])).toEqual([]);
    });

    it("an insertion in the middle paints the inserted line as solid added", () => {
        expect(gutter(["a", "c"], ["a", "b", "c"])).toEqual([{ lines: [1, 1], color: COLORS.added, dashed: false }]);
    });

    it("an insertion at the start paints the first line", () => {
        expect(gutter(["b"], ["a", "b"])).toEqual([{ lines: [0, 0], color: COLORS.added, dashed: false }]);
    });

    it("an insertion at the end paints the last line", () => {
        expect(gutter(["a"], ["a", "b"])).toEqual([{ lines: [1, 1], color: COLORS.added, dashed: false }]);
    });

    it("an edit paints the changed lines dashed", () => {
        expect(gutter(["a", "b", "c"], ["a", "B2", "C2"])).toEqual([
            { lines: [1, 2], color: COLORS.modified, dashed: true },
        ]);
    });

    it("a deletion in the middle gives one boundary line ABOVE the deletion point", () => {
        // The new file has no "b" line; the bar lands on "a".
        expect(gutter(["a", "b", "c"], ["a", "c"])).toEqual([{ lines: [0, 0], color: COLORS.deleted, dashed: false }]);
    });

    it("a deletion at the start sticks to the first line instead of going out of bounds", () => {
        // No boundary above — without the clamp the line number would be negative.
        expect(gutter(["a", "b", "c"], ["b", "c"])).toEqual([{ lines: [0, 0], color: COLORS.deleted, dashed: false }]);
    });

    it("a deletion at the end lands on the last remaining line", () => {
        expect(gutter(["a", "b", "c"], ["a", "b"])).toEqual([{ lines: [1, 1], color: COLORS.deleted, dashed: false }]);
    });

    it("several hunks give several bars", () => {
        expect(gutter(["a", "b", "c", "d", "e"], ["A", "b", "c", "E"])).toEqual([
            { lines: [0, 0], color: COLORS.modified, dashed: true },
            { lines: [3, 3], color: COLORS.modified, dashed: true },
        ]);
    });

    it("empty file → content: a bar over the whole new file", () => {
        expect(gutter([""], ["x", "y"])).toEqual([{ lines: [0, 1], color: COLORS.modified, dashed: true }]);
    });

    it("a multi-line insertion paints the whole block with one bar", () => {
        expect(gutter(["a", "z"], ["a", "b", "c", "d", "z"])).toEqual([
            { lines: [1, 3], color: COLORS.added, dashed: false },
        ]);
    });
});
