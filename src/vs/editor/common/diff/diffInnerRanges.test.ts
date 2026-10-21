import { describe, expect, it } from "vitest";

import { LineRange } from "../core/ranges/lineRange.ts";

import { DefaultLinesDiffComputer } from "./defaultLinesDiffComputer/defaultLinesDiffComputer.ts";
import { DiffInnerRanges } from "./diffInnerRanges.ts";
import { DetailedLineRangeMapping } from "./rangeMapping.ts";

function ranges(original: string[], modified: string[]): DiffInnerRanges {
    const diff = new DefaultLinesDiffComputer().computeDiff(original, modified, {
        ignoreTrimWhitespace: false,
        maxComputationTimeMs: Number.MAX_SAFE_INTEGER,
        computeMoves: false,
    });
    return new DiffInnerRanges(diff.changes);
}

describe("DiffInnerRanges", () => {
    it("an in-line edit yields a range for the changed fragment on both sides", () => {
        const inner = ranges(["const value = 1;"], ["const value = 42;"]);

        const original = inner.get("original", 0);
        const modified = inner.get("modified", 0);
        expect(original.length).toBeGreaterThan(0);
        expect(modified.length).toBeGreaterThan(0);
        expect("const value = 1;".slice(original[0].start, original[0].end)).toContain("1");
        expect("const value = 42;".slice(modified[0].start, modified[0].end)).toContain("42");
    });

    it("a change without computed innerChanges (engine timeout) does not break the projection", () => {
        const change = new DetailedLineRangeMapping(new LineRange(1, 2), new LineRange(1, 2), undefined);

        const inner = new DiffInnerRanges([change]);

        expect(inner.get("original", 0)).toEqual([]);
        expect(inner.get("modified", 0)).toEqual([]);
    });

    it("unchanged lines yield an empty list", () => {
        const inner = ranges(["same", "old"], ["same", "new"]);

        expect(inner.get("original", 0)).toEqual([]);
        expect(inner.get("modified", 0)).toEqual([]);
        expect(inner.get("modified", 99)).toEqual([]);
    });

    it("a multi-line range is split per line, tails run to the end of the line", () => {
        const inner = ranges(["start middle end", "tail"], ["start X", "Y tail"]);

        const first = inner.get("original", 0);
        expect(first.length).toBeGreaterThan(0);
        expect(first.at(-1)?.end).toBe(Number.MAX_SAFE_INTEGER);
    });

    it("two edits on one line yield two ranges", () => {
        const inner = ranges(["aaa 111 bbb 222 ccc"], ["aaa XXX bbb YYY ccc"]);

        expect(inner.get("modified", 0).length).toBeGreaterThanOrEqual(2);
        expect(inner.get("original", 0).length).toBeGreaterThanOrEqual(2);
    });

    it("a pure line insertion yields no empty ranges", () => {
        const inner = ranges(["a", "b"], ["a", "inserted", "b"]);

        for (let line = 0; line < 3; line++) {
            for (const span of [...inner.get("original", line), ...inner.get("modified", line)]) {
                expect(span.end).toBeGreaterThan(span.start);
            }
        }
    });
});
