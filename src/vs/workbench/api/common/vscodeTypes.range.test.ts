import { describe, expect, it } from "vitest";

import { Position, Range } from "./vscodeTypes.ts";

describe("VscodeTypes — Range", () => {
    it("constructors from positions and from 4 numbers are equivalent", () => {
        const a = new Range(new Position(1, 2), new Position(3, 4));
        const b = new Range(1, 2, 3, 4);
        expect(a.isEqual(b)).toBe(true);
    });

    it("swaps start/end if start is after end", () => {
        const r = new Range(new Position(3, 0), new Position(1, 0));
        expect(r.start.isEqual(new Position(1, 0))).toBe(true);
        expect(r.end.isEqual(new Position(3, 0))).toBe(true);
    });

    it("isEmpty/isSingleLine", () => {
        expect(new Range(1, 2, 1, 2).isEmpty).toBe(true);
        expect(new Range(1, 0, 1, 5).isSingleLine).toBe(true);
        expect(new Range(1, 0, 2, 0).isSingleLine).toBe(false);
    });

    it("contains(Position) — inside, on the edge, outside", () => {
        const r = new Range(1, 2, 3, 4);
        expect(r.contains(new Position(2, 0))).toBe(true);
        expect(r.contains(new Position(1, 2))).toBe(true);
        expect(r.contains(new Position(3, 4))).toBe(true);
        expect(r.contains(new Position(1, 0))).toBe(false);
        expect(r.contains(new Position(4, 0))).toBe(false);
    });

    it("contains(Range)", () => {
        const r = new Range(1, 0, 5, 0);
        expect(r.contains(new Range(2, 0, 4, 0))).toBe(true);
        expect(r.contains(new Range(0, 0, 4, 0))).toBe(false);
    });

    it("intersection/union — both sides of the start/end choice", () => {
        const a = new Range(1, 0, 3, 0);
        const b = new Range(2, 0, 5, 0);
        expect(a.intersection(b)?.isEqual(new Range(2, 0, 3, 0))).toBe(true);
        expect(a.union(b).isEqual(new Range(1, 0, 5, 0))).toBe(true);
        // Reversed operand order covers the other ternary branches.
        expect(b.intersection(a)?.isEqual(new Range(2, 0, 3, 0))).toBe(true);
        expect(b.union(a).isEqual(new Range(1, 0, 5, 0))).toBe(true);
        expect(new Range(1, 0, 2, 0).intersection(new Range(3, 0, 4, 0))).toBeUndefined();
    });

    it("with returns the same reference when nothing changes", () => {
        const r = new Range(1, 0, 2, 0);
        expect(r.with()).toBe(r);
        expect(r.with(new Position(0, 0)).start.isEqual(new Position(0, 0))).toBe(true);
        expect(r.with({ end: new Position(9, 9) }).end.isEqual(new Position(9, 9))).toBe(true);
        // {start} without end covers the fallback newEnd = this.end.
        expect(r.with({ start: new Position(0, 5) }).end.isEqual(new Position(2, 0))).toBe(true);
    });
});
