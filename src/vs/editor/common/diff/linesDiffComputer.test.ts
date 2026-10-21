import { describe, expect, it } from "vitest";

import { Position } from "../core/position.ts";
import { Range } from "../core/range.ts";
import { OffsetRange } from "../core/ranges/offsetRange.ts";
import { ArrayText } from "../core/text/abstractText.ts";

import { MyersDiffAlgorithm } from "./defaultLinesDiffComputer/algorithms/myersDiffAlgorithm.ts";
import { LinesSliceCharSequence } from "./defaultLinesDiffComputer/linesSliceCharSequence.ts";
import { getLineRangeMapping, RangeMapping } from "./rangeMapping.ts";

/** Port of upstream `editor/test/node/diffing/defaultLinesDiffComputer.test.ts`. */

describe("MyersDiffAlgorithm", () => {
    it("computes a character diff of two similar lines", () => {
        const s1 = new LinesSliceCharSequence(["hello world"], new Range(1, 1, 1, Number.MAX_SAFE_INTEGER), true);
        const s2 = new LinesSliceCharSequence(["hallo welt"], new Range(1, 1, 1, Number.MAX_SAFE_INTEGER), true);

        const result = new MyersDiffAlgorithm().compute(s1, s2);

        // Deviation: the upstream version of this case is a smoke test without assertions.
        expect(result.hitTimeout).toBe(false);
        expect(result.diffs.length).toBeGreaterThan(0);
    });
});

describe("getLineRangeMapping", () => {
    it("Simple", () => {
        expect(
            getLineRangeMapping(
                new RangeMapping(new Range(2, 1, 3, 1), new Range(2, 1, 2, 1)),
                new ArrayText(['const abc = "helloworld".split("");', "", ""]),
                new ArrayText(['const asciiLower = "helloworld".split("");', ""]),
            ).toString(),
        ).toBe("{[2,3)->[2,2)}");
    });

    it("Empty Lines", () => {
        expect(
            getLineRangeMapping(
                new RangeMapping(new Range(2, 1, 2, 1), new Range(2, 1, 4, 1)),
                new ArrayText(["", ""]),
                new ArrayText(["", "", "", ""]),
            ).toString(),
        ).toBe("{[2,2)->[2,4)}");
    });
});

describe("LinesSliceCharSequence", () => {
    const sequence = new LinesSliceCharSequence(
        ["line1: foo", "line2: fizzbuzz", "line3: barr", "line4: hello world", "line5: bazz"],
        new Range(2, 1, 5, 1),
        true,
    );

    it("translateOffset", () => {
        expect(
            OffsetRange.ofLength(sequence.length).map((offset) => sequence.translateOffset(offset).toString()),
        ).toEqual([
            ...["(2,1)", "(2,2)", "(2,3)", "(2,4)", "(2,5)", "(2,6)", "(2,7)", "(2,8)"],
            ...["(2,9)", "(2,10)", "(2,11)", "(2,12)", "(2,13)", "(2,14)", "(2,15)", "(2,16)"],
            ...["(3,1)", "(3,2)", "(3,3)", "(3,4)", "(3,5)", "(3,6)"],
            ...["(3,7)", "(3,8)", "(3,9)", "(3,10)", "(3,11)", "(3,12)"],
            ...["(4,1)", "(4,2)", "(4,3)", "(4,4)", "(4,5)", "(4,6)", "(4,7)", "(4,8)", "(4,9)", "(4,10)"],
            ...["(4,11)", "(4,12)", "(4,13)", "(4,14)", "(4,15)", "(4,16)", "(4,17)", "(4,18)", "(4,19)"],
        ]);
    });

    it("extendToFullLines", () => {
        expect(sequence.getText(sequence.extendToFullLines(new OffsetRange(20, 25)))).toBe("line3: barr\n");
        expect(sequence.getText(sequence.extendToFullLines(new OffsetRange(20, 45)))).toBe(
            "line3: barr\nline4: hello world\n",
        );
    });

    it("translateOffset yields a position inside the slice", () => {
        expect(sequence.translateOffset(0)).toEqual(new Position(2, 1));
    });
});
