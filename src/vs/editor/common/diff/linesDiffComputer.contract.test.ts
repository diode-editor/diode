import { describe, expect, it } from "vitest";

import { DefaultLinesDiffComputer } from "./defaultLinesDiffComputer/defaultLinesDiffComputer.ts";
import type { ILinesDiffComputerOptions } from "./linesDiffComputer.ts";

/**
 * Not a retelling of upstream (the corpus is `diffFixtures.test.ts`) but the properties
 * we rely on. Expectations are captured from real runs, not derived from the code.
 */

const BASE: ILinesDiffComputerOptions = {
    ignoreTrimWhitespace: false,
    maxComputationTimeMs: Number.MAX_SAFE_INTEGER,
    computeMoves: false,
};

function diff(original: string[], modified: string[], patch: Partial<ILinesDiffComputerOptions> = {}) {
    return new DefaultLinesDiffComputer().computeDiff(original, modified, { ...BASE, ...patch });
}

describe("DefaultLinesDiffComputer — contract", () => {
    it("identical texts yield an empty change set", () => {
        const result = diff(["a", "b"], ["a", "b"]);
        expect(result.changes).toHaveLength(0);
        expect(result.moves).toHaveLength(0);
        expect(result.hitTimeout).toBe(false);
    });

    it("empty → content: one insertion covering the whole file", () => {
        const result = diff([""], ["x", "y"]);
        expect(result.changes.map((c) => c.toString())).toEqual(["{[1,2)->[1,3)}"]);
    });

    it("content → empty: one deletion covering the whole file", () => {
        const result = diff(["x", "y"], [""]);
        expect(result.changes.map((c) => c.toString())).toEqual(["{[1,3)->[1,2)}"]);
    });

    it("inserting a line in the middle leaves neighbors untouched", () => {
        // The original range is empty ([2,2)): an insertion between lines, not a replacement.
        const result = diff(["a", "c"], ["a", "b", "c"]);
        expect(result.changes.map((c) => c.toString())).toEqual(["{[2,2)->[2,3)}"]);
    });

    it("deleting a line from the middle leaves neighbors untouched", () => {
        const result = diff(["a", "b", "c"], ["a", "c"]);
        expect(result.changes.map((c) => c.toString())).toEqual(["{[2,3)->[2,2)}"]);
    });

    it("innerChanges narrow the edit down to the changed characters", () => {
        const result = diff(["const a = 1;"], ["const a = 2;"]);
        expect(result.changes).toHaveLength(1);
        expect(result.changes[0].innerChanges?.map((i) => i.toString())).toEqual(["{[1,11 -> 1,12]->[1,11 -> 1,12]}"]);
    });

    it("ignoreTrimWhitespace drops a difference only in trailing whitespace", () => {
        expect(diff(["a"], ["a  "], { ignoreTrimWhitespace: false }).changes).toHaveLength(1);
        expect(diff(["a"], ["a  "], { ignoreTrimWhitespace: true }).changes).toHaveLength(0);
    });

    it("computeMoves finds a moved block and is turned off by the option", () => {
        const block = ["function moved() {", "    const a = 1;", "    const b = 2;", "    return a + b;", "}"];
        const tail = ["function stays() {", "    return 42;", "}"];
        const original = [...block, "", ...tail];
        const modified = [...tail, "", ...block];

        const withMoves = diff(original, modified, { computeMoves: true });
        expect(withMoves.moves.map((m) => m.lineRangeMapping.toString())).toEqual(["{[6,10)->[1,5)}"]);

        expect(diff(original, modified, { computeMoves: false }).moves).toHaveLength(0);
    });

    it("maxComputationTimeMs raises hitTimeout instead of hanging", () => {
        const original = Array.from({ length: 4000 }, (_, i) => `line ${i}`);
        const modified = Array.from({ length: 4000 }, (_, i) => `LINE ${(i * 7) % 4000}`);

        const result = diff(original, modified, { maxComputationTimeMs: 1 });

        expect(result.hitTimeout).toBe(true);
        expect(result.changes.length).toBeGreaterThan(0);
    });
});
