import { DisplayLine } from "@tuidom/core/common/displayLine";
import type { RenderContext } from "@tuidom/core/dom/tuiElement";
import { describe, expect, it } from "vitest";

import { createRange, type IRange } from "../common/core/iRange.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";
import { NO_LINE_INSERTIONS } from "../common/viewModel/lineInsertions.ts";

import {
    buildViewportRows,
    type ITextViewportGeometry,
    paintPhantomText,
    paintSortedRangeBackgrounds,
} from "./textViewRendering.ts";

const LINES = 1000;
const BG = 7;

function makeViewState(): EditorViewState {
    return new EditorViewState(new TextDocument(Array.from({ length: LINES }, (_, i) => `foo ${i}`).join("\n")));
}

function geometry(scrollTop: number, visibleLines: number): ITextViewportGeometry {
    const viewState = makeViewState();
    return {
        scrollTop,
        scrollLeft: 0,
        visibleLines,
        viewLineCount: LINES,
        contentCols: 20,
        gutterW: 0,
        insertions: NO_LINE_INSERTIONS,
        rows: buildViewportRows(viewState, scrollTop, visibleLines, NO_LINE_INSERTIONS),
    };
}

/** Cells the pass painted, as `x,y`. */
function paint(ranges: readonly IRange[], geo: ITextViewportGeometry, skipIndex?: number): Set<string> {
    const cells = new Set<string>();
    const context = {
        setCell: (x: number, y: number) => {
            cells.add(`${x},${y}`);
        },
    } as unknown as RenderContext;
    paintSortedRangeBackgrounds(context, ranges, BG, geo, skipIndex);
    return cells;
}

/** One `foo` per line; counts the elements the pass reads. */
function countedRanges(): { ranges: readonly IRange[]; reads: () => number } {
    const target = Array.from({ length: LINES }, (_, line) => createRange(line, 0, line, 3));
    let reads = 0;
    const ranges = new Proxy(target, {
        get(array, key, receiver) {
            if (typeof key === "string" && /^\d+$/.test(key)) reads++;
            return Reflect.get(array, key, receiver) as unknown;
        },
    });
    return { ranges, reads: () => reads };
}

describe("buildViewportRows", () => {
    it("resolves one row per visible line, no more", () => {
        const rows = buildViewportRows(makeViewState(), 10, 5, NO_LINE_INSERTIONS);

        expect(rows.map((row) => [row.screenY, row.logLine])).toEqual([
            [0, 10],
            [1, 11],
            [2, 12],
            [3, 13],
            [4, 14],
        ]);
    });

    it("stops at the end of the file", () => {
        expect(geometry(LINES - 2, 5).rows.map((row) => row.logLine)).toEqual([LINES - 2, LINES - 1]);
    });
});

describe("paintPhantomText", () => {
    it("a wide character cut by the left edge is not painted, the text after it is", () => {
        const cells: [number, string][] = [];
        const context = {
            setCell: (x: number, _y: number, cell: { char: string }) => {
                cells.push([x, cell.char]);
            },
        } as unknown as RenderContext;

        paintPhantomText(context, {
            displayLine: new DisplayLine("\u65e5x", 4), // "ri" (sun), 2 columns wide
            screenY: 0,
            gutterW: 2,
            contentCols: 10,
            fg: 1,
            bg: 2,
            style: 0,
            scrollLeft: 1,
        });

        expect(cells).toEqual([[3, "x"]]);
    });
});

describe("paintSortedRangeBackgrounds", () => {
    it("paints the ranges on the visible lines", () => {
        const { ranges } = countedRanges();
        const cells = paint(ranges, geometry(500, 3));

        expect([...cells].sort()).toEqual(["0,0", "0,1", "0,2", "1,0", "1,1", "1,2", "2,0", "2,1", "2,2"]);
    });

    it("reads the visible ranges and a binary search, not the whole set", () => {
        const { ranges, reads } = countedRanges();
        paint(ranges, geometry(500, 3));

        // Three visible ranges, the one past them and ~log2(1000) probes.
        expect(reads()).toBeLessThan(30);
    });

    it("leaves out the skipped range", () => {
        const { ranges } = countedRanges();
        const cells = paint(ranges, geometry(500, 3), 501);

        expect(cells.has("0,1")).toBe(false);
        expect(cells.has("0,0")).toBe(true);
    });
});
