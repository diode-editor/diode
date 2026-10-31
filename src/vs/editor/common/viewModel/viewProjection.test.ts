import { describe, expect, it } from "vitest";

import { SPLICE_CHUNK } from "../../../base/common/arrays.ts";
import type { IDocumentContentChange } from "../model/iDocumentContentChange.ts";

import type { IHiddenRange, IViewProjection, LineBreaksProvider } from "./viewProjection.ts";
import {
    ArrayProjection,
    buildArrayProjection,
    collectHiddenRanges,
    decodeViewZoneAnchor,
    encodeViewZoneRow,
    hiddenRangesEqual,
    IdentityProjection,
    mergeLineChanges,
    shiftHiddenRanges,
} from "./viewProjection.ts";

const NO_BREAKS: LineBreaksProvider = () => null;

/** Every row as `line` or `line@offset`, `·` for a zone row. */
function sketch(projection: IViewProjection): string {
    const parts: string[] = [];
    for (let row = 0; row < projection.rowCount; row++) {
        const doc = projection.docLineOfRow(row);
        if (doc < 0) {
            parts.push("·");
            continue;
        }
        const offset = projection.startOffsetOfRow(row);
        parts.push(offset === 0 ? String(doc) : `${String(doc)}@${String(offset)}`);
    }
    return parts.join(" ");
}

function firstRows(projection: IViewProjection, lineCount: number): number[] {
    const rows: number[] = [];
    for (let line = 0; line < lineCount; line++) rows.push(projection.firstRowOfDocLine(line));
    return rows;
}

function change(startLine: number, oldEndLine: number, newEndLine: number): IDocumentContentChange {
    return { startLine, oldEndLine, newEndLine };
}

describe("IdentityProjection", () => {
    const projection = new IdentityProjection(3);

    it("maps rows and lines 1:1 inside the document", () => {
        expect(projection.rowCount).toBe(3);
        expect(projection.docLineOfRow(0)).toBe(0);
        expect(projection.docLineOfRow(2)).toBe(2);
        expect(projection.firstRowOfDocLine(0)).toBe(0);
        expect(projection.firstRowOfDocLine(2)).toBe(2);
        expect(projection.startOffsetOfRow()).toBe(0);
        expect(projection.zoneRowAt()).toBeNull();
    });

    it("answers -1 outside the document in both directions", () => {
        expect(projection.docLineOfRow(3)).toBe(-1);
        expect(projection.docLineOfRow(-1)).toBe(-1);
        // -2 and not only -1: a bounds check that lets a negative row through would hand back -1 by accident.
        expect(projection.docLineOfRow(-2)).toBe(-1);
        expect(projection.firstRowOfDocLine(3)).toBe(-1);
        expect(projection.firstRowOfDocLine(-1)).toBe(-1);
        expect(projection.firstRowOfDocLine(-2)).toBe(-1);
    });
});

describe("buildArrayProjection", () => {
    it("drops hidden lines and expands wrap points into fragment rows", () => {
        const hidden: IHiddenRange[] = [{ from: 2, to: 3 }];
        const breaksFor: LineBreaksProvider = (line) => (line === 1 ? [4, 8] : null);
        const projection = buildArrayProjection(5, hidden, breaksFor, []);

        expect(sketch(projection)).toBe("0 1 1@4 1@8 4");
        expect(firstRows(projection, 5)).toEqual([0, 1, -1, -1, 4]);
        expect(projection.hasZones).toBe(false);
    });

    it("answers past the view with -1 / 0 and never counts from the end for a negative row", () => {
        const projection = buildArrayProjection(2, [], NO_BREAKS, []);
        expect(projection.docLineOfRow(2)).toBe(-1);
        expect(projection.docLineOfRow(-1)).toBe(-1);
        expect(projection.docLineOfRow(-2)).toBe(-1);
        expect(projection.firstRowOfDocLine(-2)).toBe(-1);
        expect(projection.startOffsetOfRow(2)).toBe(0);
        expect(projection.startOffsetOfRow(-1)).toBe(0);
        expect(projection.firstRowOfDocLine(2)).toBe(-1);
        expect(projection.firstRowOfDocLine(-1)).toBe(-1);
        expect(projection.zoneRowAt(5)).toBeNull();
    });

    it("places zone rows after the last fragment of their anchor and reports anchor/offset", () => {
        const breaksFor: LineBreaksProvider = (line) => (line === 0 ? [3] : null);
        const projection = buildArrayProjection(2, [], breaksFor, [{ afterLine: 0, size: 2 }]);

        expect(sketch(projection)).toBe("0 0@3 · · 1");
        expect(projection.hasZones).toBe(true);
        expect(projection.zoneRowAt(2)).toEqual({ anchor: 0, offset: 0 });
        expect(projection.zoneRowAt(3)).toEqual({ anchor: 0, offset: 1 });
        expect(projection.zoneRowAt(1)).toBeNull();
        expect(projection.docLineOfRow(2)).toBe(encodeViewZoneRow(0));
        expect(firstRows(projection, 2)).toEqual([0, 4]);
    });

    it("keeps a zone whose anchor is hidden by a fold, after the last visible line above it", () => {
        const projection = buildArrayProjection(4, [{ from: 1, to: 2 }], NO_BREAKS, [{ afterLine: 2, size: 1 }]);
        expect(sketch(projection)).toBe("0 · 3");
        expect(projection.zoneRowAt(1)).toEqual({ anchor: 2, offset: 0 });
    });

    it("puts a zone anchored before the first line at the top", () => {
        const projection = buildArrayProjection(2, [], NO_BREAKS, [{ afterLine: -1, size: 1 }]);
        expect(sketch(projection)).toBe("· 0 1");
        expect(projection.zoneRowAt(0)).toEqual({ anchor: -1, offset: 0 });
        expect(decodeViewZoneAnchor(projection.docLineOfRow(0))).toBe(-1);
    });
});

describe("ArrayProjection.applyLineChange", () => {
    const breaksAt = (wrapped: Readonly<Record<number, number[]>>): LineBreaksProvider => {
        return (line) => wrapped[line] ?? null;
    };

    function expectReplayMatchesBuild(
        before: { lineCount: number; hidden: IHiddenRange[]; breaks: Record<number, number[]> },
        edit: IDocumentContentChange,
        after: { hidden: IHiddenRange[]; breaks: Record<number, number[]> },
    ): ArrayProjection {
        const projection = buildArrayProjection(before.lineCount, before.hidden, breaksAt(before.breaks), []);
        projection.applyLineChange(edit, after.hidden, breaksAt(after.breaks));
        const lineCount = before.lineCount + edit.newEndLine - edit.oldEndLine;
        const fresh = buildArrayProjection(lineCount, after.hidden, breaksAt(after.breaks), []);
        expect(sketch(projection)).toBe(sketch(fresh));
        expect(firstRows(projection, lineCount)).toEqual(firstRows(fresh, lineCount));
        expect(projection.firstRowOfDocLine(lineCount)).toBe(-1);
        return projection;
    }

    it("inserting lines below a hidden range shifts the rows after it", () => {
        const projection = expectReplayMatchesBuild(
            { lineCount: 6, hidden: [{ from: 1, to: 2 }], breaks: {} },
            change(4, 4, 6),
            { hidden: [{ from: 1, to: 2 }], breaks: {} },
        );
        expect(sketch(projection)).toBe("0 3 4 5 6 7");
    });

    it("deleting lines above a hidden range shifts it up", () => {
        const projection = expectReplayMatchesBuild(
            { lineCount: 7, hidden: [{ from: 4, to: 5 }], breaks: {} },
            change(0, 2, 0),
            { hidden: [{ from: 2, to: 3 }], breaks: {} },
        );
        expect(sketch(projection)).toBe("0 1 4");
    });

    it("an edit inside a hidden body adds no rows, only shifts the lines below", () => {
        const projection = expectReplayMatchesBuild(
            { lineCount: 5, hidden: [{ from: 1, to: 3 }], breaks: {} },
            change(2, 2, 4),
            { hidden: [{ from: 1, to: 5 }], breaks: {} },
        );
        expect(sketch(projection)).toBe("0 6");
    });

    it("a change within one line re-reads its wrap points (fragments appear and disappear)", () => {
        const grown = expectReplayMatchesBuild({ lineCount: 3, hidden: [], breaks: {} }, change(1, 1, 1), {
            hidden: [],
            breaks: { 1: [5, 10] },
        });
        expect(sketch(grown)).toBe("0 1 1@5 1@10 2");

        const shrunk = expectReplayMatchesBuild({ lineCount: 3, hidden: [], breaks: { 1: [5, 10] } }, change(1, 1, 1), {
            hidden: [],
            breaks: {},
        });
        expect(sketch(shrunk)).toBe("0 1 2");
    });

    it("replaces the fragments of every edited line, wrapped neighbors included", () => {
        const projection = expectReplayMatchesBuild(
            { lineCount: 5, hidden: [], breaks: { 0: [2], 1: [3], 2: [4], 4: [6] } },
            change(1, 2, 1),
            { hidden: [], breaks: { 0: [2], 1: [7], 3: [6] } },
        );
        expect(sketch(projection)).toBe("0 0@2 1 1@7 2 3 3@6");
    });

    it("handles the first and the last line of the document", () => {
        expectReplayMatchesBuild({ lineCount: 3, hidden: [], breaks: {} }, change(0, 0, 1), { hidden: [], breaks: {} });
        expectReplayMatchesBuild({ lineCount: 3, hidden: [], breaks: {} }, change(2, 2, 3), { hidden: [], breaks: {} });
        expectReplayMatchesBuild({ lineCount: 3, hidden: [], breaks: {} }, change(1, 2, 1), { hidden: [], breaks: {} });
    });

    it("splices more rows than one spread call takes (a paste of wrapped lines)", () => {
        const inserted = SPLICE_CHUNK + 5;
        const breaks: Record<number, number[]> = {};
        for (let line = 1; line <= inserted; line++) breaks[line] = [3];
        const projection = expectReplayMatchesBuild({ lineCount: 3, hidden: [], breaks: {} }, change(1, 1, inserted), {
            hidden: [],
            breaks,
        });
        expect(projection.rowCount).toBe(1 + inserted * 2 + 1);
        expect(projection.docLineOfRow(projection.rowCount - 1)).toBe(inserted + 1);
    });
});

describe("mergeLineChanges", () => {
    it("an edit below the first one maps its old end back through the first delta", () => {
        // Insert 2 lines at 5, then delete current lines 8-9: base 5..7 becomes current 5..8.
        expect(mergeLineChanges(change(5, 5, 7), change(8, 9, 8))).toEqual({
            startLine: 5,
            oldEndLine: 7,
            newEndLine: 8,
        });
    });

    it("an edit above or inside the first one extends the new end by its own delta", () => {
        expect(mergeLineChanges(change(5, 5, 7), change(0, 0, 2))).toEqual({
            startLine: 0,
            oldEndLine: 5,
            newEndLine: 9,
        });
        expect(mergeLineChanges(change(5, 5, 7), change(6, 6, 6))).toEqual({
            startLine: 5,
            oldEndLine: 5,
            newEndLine: 7,
        });
    });

    it("an edit spanning the first one on both sides", () => {
        expect(mergeLineChanges(change(5, 5, 7), change(3, 8, 3))).toEqual({
            startLine: 3,
            oldEndLine: 6,
            newEndLine: 3,
        });
    });

    it("a reload is merged as the whole-document change it reports", () => {
        expect(mergeLineChanges(change(3, 3, 4), { ...change(0, 5, 2), isFlush: true })).toEqual({
            startLine: 0,
            oldEndLine: 4,
            newEndLine: 2,
        });
    });
});

describe("collectHiddenRanges", () => {
    it("takes collapsed regions only, as sorted body ranges", () => {
        const hidden = collectHiddenRanges([
            { startLine: 10, endLine: 12, isCollapsed: true },
            { startLine: 0, endLine: 5, isCollapsed: false },
            { startLine: 2, endLine: 4, isCollapsed: true },
        ]);
        expect(hidden).toEqual([
            { from: 3, to: 4 },
            { from: 11, to: 12 },
        ]);
    });
});

describe("hiddenRangesEqual", () => {
    it("compares length, from and to", () => {
        const a: IHiddenRange[] = [
            { from: 1, to: 2 },
            { from: 5, to: 9 },
        ];
        expect(hiddenRangesEqual(a, [...a])).toBe(true);
        expect(hiddenRangesEqual(a, a.slice(0, 1))).toBe(false);
        expect(hiddenRangesEqual(a, [a[0], { from: 6, to: 9 }])).toBe(false);
        expect(hiddenRangesEqual(a, [a[0], { from: 5, to: 8 }])).toBe(false);
        expect(hiddenRangesEqual([], [])).toBe(true);
    });
});

describe("shiftHiddenRanges", () => {
    const ranges: IHiddenRange[] = [
        { from: 3, to: 5 },
        { from: 10, to: 12 },
    ];

    it("keeps ranges above the edit and moves ranges below it by the line delta", () => {
        expect(shiftHiddenRanges(ranges, change(7, 7, 9))).toEqual([
            { from: 3, to: 5 },
            { from: 12, to: 14 },
        ]);
        expect(shiftHiddenRanges(ranges, change(6, 8, 6))).toEqual([
            { from: 3, to: 5 },
            { from: 8, to: 10 },
        ]);
    });

    it("an edit right below a body (on the line after it) is still a plain shift of the next range", () => {
        expect(shiftHiddenRanges(ranges, change(6, 6, 7))).toEqual([
            { from: 3, to: 5 },
            { from: 11, to: 13 },
        ]);
    });

    it("resizes a body the edit stays inside, including an edit on its first or last line", () => {
        expect(shiftHiddenRanges(ranges, change(4, 4, 6))).toEqual([
            { from: 3, to: 7 },
            { from: 12, to: 14 },
        ]);
        expect(shiftHiddenRanges(ranges, change(5, 5, 7))).toEqual([
            { from: 3, to: 7 },
            { from: 12, to: 14 },
        ]);
        expect(shiftHiddenRanges(ranges, change(3, 5, 3))).toEqual([
            { from: 3, to: 3 },
            { from: 8, to: 10 },
        ]);
    });

    it("gives up when the edit touches a header or runs past a body", () => {
        expect(shiftHiddenRanges(ranges, change(2, 2, 3))).toBeNull();
        expect(shiftHiddenRanges(ranges, change(1, 2, 1))).toBeNull();
        expect(shiftHiddenRanges(ranges, change(4, 6, 4))).toBeNull();
        expect(shiftHiddenRanges(ranges, change(9, 10, 9))).toBeNull();
    });
});
