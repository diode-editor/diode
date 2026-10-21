import { describe, expect, it } from "vitest";

import { DefaultLinesDiffComputer } from "./defaultLinesDiffComputer/defaultLinesDiffComputer.ts";
import type { IDiffViewOptions, IDiffViewRow } from "./diffViewModel.ts";
import { DEFAULT_DIFF_VIEW_OPTIONS, DiffViewModel } from "./diffViewModel.ts";

/** Input is texts and the real engine, not made-up `LineRange`s: an upstream pin bump fails here. */

const COMPUTER = new DefaultLinesDiffComputer();

function model(original: string[], modified: string[], options: Partial<IDiffViewOptions> = {}): DiffViewModel {
    const diff = COMPUTER.computeDiff(original, modified, {
        ignoreTrimWhitespace: false,
        maxComputationTimeMs: Number.MAX_SAFE_INTEGER,
        computeMoves: false,
    });
    return new DiffViewModel(diff.changes, original.length, modified.length, options);
}

/** Compact notation for view rows: `=o/m`, `-o`, `+m`, `[⋯N#i]`. */
function sketch(rows: readonly IDiffViewRow[]): string {
    return rows
        .map((row) => {
            switch (row.kind) {
                case "unchanged":
                    return `=${String(row.originalLine)}/${String(row.modifiedLine)}`;
                case "deleted":
                    return `-${String(row.originalLine)}`;
                case "added":
                    return `+${String(row.modifiedLine)}`;
                default:
                    return `[⋯${String(row.hiddenLineCount)}#${String(row.regionIndex)}]`;
            }
        })
        .join(" ");
}

function shape(rows: readonly IDiffViewRow[]): string {
    return rows
        .map((row) =>
            row.kind === "unchanged" ? "=" : row.kind === "deleted" ? "-" : row.kind === "added" ? "+" : "⋯",
        )
        .join("");
}

const lines = (count: number): string[] => Array.from({ length: count }, (_, i) => `line${String(i)}`);

const COLLAPSED: Partial<IDiffViewOptions> = { hideUnchangedRegions: true };

describe("DiffViewModel — full-file mode (default)", () => {
    it("hides nothing by default — like diffEditor.hideUnchangedRegions upstream", () => {
        expect(DEFAULT_DIFF_VIEW_OPTIONS.hideUnchangedRegions).toBe(false);
        expect(model(lines(40), lines(40)).regions).toEqual([]);
    });

    it("identical texts yield exactly one row per file line", () => {
        const rows = model(lines(4), lines(4)).rows;

        expect(sketch(rows)).toBe("=0/0 =1/1 =2/2 =3/3");
    });

    it("an insertion yields added without shifting neighbor line numbers", () => {
        expect(sketch(model(["a", "c"], ["a", "b", "c"]).rows)).toBe("=0/0 +1 =1/2");
    });

    it("a deletion yields deleted", () => {
        expect(sketch(model(["a", "b", "c"], ["a", "c"]).rows)).toBe("=0/0 -1 =2/1");
    });

    it("an edit shows as a deleted line, then an added one", () => {
        expect(sketch(model(["a", "b", "c"], ["a", "B", "c"]).rows)).toBe("=0/0 -1 +1 =2/2");
    });

    it("a multi-line edit yields all deleted lines first, then all added ones", () => {
        expect(shape(model(["a", "b", "c", "d"], ["a", "B", "C", "d"]).rows)).toBe("=--++=");
    });

    it("empty original — added lines only", () => {
        expect(shape(model([""], ["x", "y"]).rows)).toBe("-++");
    });

    it("empty modified — deleted lines only", () => {
        expect(shape(model(["x", "y"], [""]).rows)).toBe("--+");
    });
});

describe("DiffViewModel — folding unchanged chunks", () => {
    it("identical files collapse entirely into one placeholder", () => {
        const m = model(lines(20), lines(20), COLLAPSED);

        expect(sketch(m.rows)).toBe("[⋯20#0]");
        expect(m.regions).toHaveLength(1);
        expect(m.regions[0]).toMatchObject({ originalStartLine: 0, lineCount: 20, hiddenLineCount: 20 });
    });

    it("context remains on both sides around a change in the middle", () => {
        const original = lines(20);
        const modified = [...lines(20).slice(0, 9), "X", ...lines(20).slice(10)];

        expect(sketch(model(original, modified, COLLAPSED).rows)).toBe(
            "[⋯6#0] =6/6 =7/7 =8/8 -9 +9 =10/10 =11/11 =12/12 [⋯7#1]",
        );
    });

    it("at the file edge context is trimmed only on the inner side", () => {
        const atStart = model(lines(20), ["X", ...lines(20).slice(1)], COLLAPSED);
        const atEnd = model(lines(20), [...lines(20).slice(0, 19), "X"], COLLAPSED);

        expect(sketch(atStart.rows)).toBe("-0 +0 =1/1 =2/2 =3/3 [⋯16#0]");
        expect(sketch(atEnd.rows)).toBe("[⋯16#0] =16/16 =17/17 =18/18 -19 +19");
    });

    it("a short gap between changes does not fold", () => {
        expect(shape(model(["a", "b", "c", "d", "e"], ["A", "b", "c", "d", "E"], COLLAPSED).rows)).toBe("-+===-+");
    });

    it("a gap exactly at the minimum folds, one line shorter does not", () => {
        // The middle needs contextLineCount * 2 + minimumHiddenLineCount = 9.
        const gap = (n: number) => {
            const middle = lines(n).map((l) => `mid-${l}`);
            return model(["a", ...middle, "z"], ["A", ...middle, "Z"], COLLAPSED);
        };

        expect(shape(gap(9).rows)).toBe("-+===⋯===-+");
        expect(shape(gap(8).rows)).toBe("-+========-+");
    });

    it("regionIndex in a placeholder points to an existing region", () => {
        const original = lines(30);
        const modified = [...lines(30).slice(0, 14), "X", ...lines(30).slice(15)];
        const m = model(original, modified, COLLAPSED);

        const placeholders = m.rows.filter((r) => r.kind === "collapsed");
        expect(placeholders).toHaveLength(2);
        for (const row of placeholders) {
            expect(m.regions[row.regionIndex]).toBeDefined();
            expect(m.regions[row.regionIndex].hiddenLineCount).toBe(row.hiddenLineCount);
        }
    });

    it("visible and hidden lines together cover the file", () => {
        const original = lines(30);
        const modified = [...lines(30).slice(0, 14), "X", ...lines(30).slice(15)];
        const m = model(original, modified, COLLAPSED);

        const visible = m.rows.filter((r) => r.kind === "unchanged" || r.kind === "added").length;
        const hidden = m.rows.reduce((sum, r) => sum + (r.kind === "collapsed" ? r.hiddenLineCount : 0), 0);
        expect(visible + hidden).toBe(modified.length);
    });

    it("context and minimum settings are respected", () => {
        const original = lines(20);
        const modified = [...lines(20).slice(0, 9), "X", ...lines(20).slice(10)];
        const m = model(original, modified, { hideUnchangedRegions: true, contextLineCount: 1 });

        expect(sketch(m.rows)).toBe("[⋯8#0] =8/8 -9 +9 =10/10 [⋯9#1]");
    });

    it("a huge hide minimum disables folding", () => {
        const m = model(lines(20), lines(20), { hideUnchangedRegions: true, minimumHiddenLineCount: 1000 });

        expect(m.regions).toEqual([]);
        expect(shape(m.rows)).toBe("=".repeat(20));
    });
});

describe("DiffViewModel — reveal", () => {
    const original = lines(30);
    const modified = [...lines(30).slice(0, 9), "X", ...lines(30).slice(10)];
    const build = () => model(original, modified, COLLAPSED);

    it("a full reveal removes the placeholder", () => {
        const m = build();
        m.expandRegion(0);

        expect(m.regions[0].hiddenLineCount).toBe(0);
        expect(m.rows.some((r) => r.kind === "collapsed" && r.regionIndex === 0)).toBe(false);
    });

    it("a partial reveal from the top opens lines before the placeholder", () => {
        const m = build();
        const before = shape(m.rows);
        m.expandRegion(1, "top", 4);

        expect(m.regions[1].hiddenLineCount).toBe(13);
        expect(m.regions[1].visibleTop).toBe(4);
        expect(shape(m.rows)).toBe(before.replace("+===⋯", "+=======⋯"));
    });

    it("a partial reveal from the bottom opens lines after the placeholder", () => {
        const m = build();
        m.expandRegion(1, "bottom", 4);

        expect(m.regions[1].visibleBottom).toBe(4);
        expect(shape(m.rows).endsWith("⋯====")).toBe(true);
    });

    it("a reveal beyond the chunk size clamps instead of going negative", () => {
        const m = build();
        m.expandRegion(1, "top", 999);

        expect(m.regions[1].hiddenLineCount).toBe(0);
        expect(m.regions[1].visibleTop).toBe(17);
        expect(m.rows.some((r) => r.kind === "collapsed" && r.regionIndex === 1)).toBe(false);
    });

    it("reveals from both edges do not overlap", () => {
        const m = build();
        m.expandRegion(1, "top", 999);
        m.expandRegion(1, "bottom", 999);

        expect(m.regions[1].visibleTop + m.regions[1].visibleBottom).toBe(m.regions[1].lineCount);
        expect(m.regions[1].hiddenLineCount).toBe(0);
    });

    it("the default step is revealLineCount", () => {
        const m = model(original, modified, { hideUnchangedRegions: true, revealLineCount: 5 });
        m.expandRegion(1, "top");

        expect(m.regions[1].visibleTop).toBe(5);
    });

    it("expandAll expands all chunks", () => {
        const m = build();
        m.expandAll();

        expect(m.regions.every((r) => r.hiddenLineCount === 0)).toBe(true);
        expect(m.rows.some((r) => r.kind === "collapsed")).toBe(false);
        expect(m.rows).toHaveLength(modified.length + 1); // +1 for the edit's deleted line
    });

    it("an unknown index is a no-op, including a negative one", () => {
        // `at(-1)` would return the last element, so expandRegion(-1) would expand another region.
        const m = build();
        const before = sketch(m.rows);

        m.expandRegion(99);
        m.expandRegion(-1);

        expect(sketch(m.rows)).toBe(before);
    });

    it("a zero step changes nothing", () => {
        const m = build();
        const before = sketch(m.rows);
        m.expandRegion(1, "top", 0);

        expect(sketch(m.rows)).toBe(before);
    });

    it("a negative step does not fold what is already revealed", () => {
        const m = build();
        m.expandRegion(1, "top", 4);
        m.expandRegion(1, "top", -10);

        expect(m.regions[1].visibleTop).toBe(4);
    });

    it("nothing to reveal in full-file mode", () => {
        const m = model(original, modified);
        const before = sketch(m.rows);

        m.expandAll();

        expect(m.regions).toEqual([]);
        expect(sketch(m.rows)).toBe(before);
    });
});
