import { describe, expect, it } from "vitest";

import { TextDocument } from "../model/textDocument.ts";
import { EditorViewState } from "../viewModel/editorViewState.ts";

import { DefaultLinesDiffComputer } from "./defaultLinesDiffComputer/defaultLinesDiffComputer.ts";
import { DiffInnerRanges } from "./diffInnerRanges.ts";
import { DiffViewModel } from "./diffViewModel.ts";
import { computeDiffV2Layout, DIFF_FILLER_CHAR } from "./diffV2Layout.ts";

/**
 * Раскладка v2: вход — пара текстов и настоящий движок (как в
 * diffViewModel.test.ts); главный гейт — инвариант «у сторон одинаковое число
 * строк вью», проверяемый настоящими EditorViewState с зонами и фолдами.
 */

const COMPUTER = new DefaultLinesDiffComputer();

function layoutOf(original: string[], modified: string[], collapsed = false) {
    const diff = COMPUTER.computeDiff(original, modified, {
        ignoreTrimWhitespace: false,
        maxComputationTimeMs: Number.MAX_SAFE_INTEGER,
        computeMoves: false,
    });
    const model = new DiffViewModel(diff.changes, original.length, modified.length, {
        hideUnchangedRegions: collapsed,
    });
    const layout = computeDiffV2Layout(diff.changes, model.regions, new DiffInnerRanges(diff.changes), {
        original: original.length,
        modified: modified.length,
    });
    return { layout, original, modified };
}

/** Стороны на настоящих view-state: число строк вью обязано совпасть. */
function viewLineCounts(input: ReturnType<typeof layoutOf>): { original: number; modified: number } {
    const sides = { original: input.original, modified: input.modified };
    const result = { original: 0, modified: 0 };
    for (const side of ["original", "modified"] as const) {
        const state = new EditorViewState(new TextDocument(sides[side].join("\n")));
        state.setFoldingRegions([...input.layout[side].foldingRegions.map((r) => ({ ...r }))]);
        state.setViewZones(input.layout[side].zones);
        result[side] = state.getViewLineCount();
    }
    return result;
}

const lines = (count: number, prefix = "l"): string[] =>
    Array.from({ length: count }, (_, i) => `${prefix}${String(i)}`);

describe("computeDiffV2Layout — зоны-филлеры", () => {
    it("чистая вставка даёт зону у original напротив добавленных строк", () => {
        const input = layoutOf(["a", "c"], ["a", "b1", "b2", "c"]);

        expect(input.layout.original.zones).toEqual([{ afterLine: 0, size: 2 }]);
        expect(input.layout.modified.zones).toEqual([]);
        expect(input.layout.original.decorations.zones?.[0]).toMatchObject({
            fillChar: DIFF_FILLER_CHAR,
            colorToken: "diffEditor.diagonalFill",
        });
        const counts = viewLineCounts(input);
        expect(counts.original).toBe(counts.modified);
    });

    it("чистое удаление даёт зону у modified", () => {
        const input = layoutOf(["a", "x", "y", "c"], ["a", "c"]);

        expect(input.layout.modified.zones).toEqual([{ afterLine: 0, size: 2 }]);
        expect(input.layout.original.zones).toEqual([]);
        const counts = viewLineCounts(input);
        expect(counts.original).toBe(counts.modified);
    });

    it("правка с перевесом: зона размером в разницу у короткой стороны", () => {
        const input = layoutOf(["a", "x", "c"], ["a", "X1", "X2", "X3", "c"]);

        expect(input.layout.original.zones).toEqual([{ afterLine: 1, size: 2 }]);
        const counts = viewLineCounts(input);
        expect(counts.original).toBe(counts.modified);
    });

    it("равная замена зон не порождает", () => {
        const input = layoutOf(["a", "x", "c"], ["a", "X", "c"]);

        expect(input.layout.original.zones).toEqual([]);
        expect(input.layout.modified.zones).toEqual([]);
    });
});

describe("computeDiffV2Layout — декорации", () => {
    it("фоны строк, маркеры и intra-line по своим сторонам", () => {
        const input = layoutOf(["a", "old line", "c"], ["a", "new line", "c"]);

        expect(input.layout.original.decorations.lineBackgrounds).toEqual([
            { startLine: 1, endLine: 1, colorToken: "diffEditor.removedLineBackground" },
        ]);
        expect(input.layout.modified.decorations.lineBackgrounds).toEqual([
            { startLine: 1, endLine: 1, colorToken: "diffEditor.insertedLineBackground" },
        ]);
        expect(input.layout.original.decorations.gutterMarkers).toEqual([{ line: 1, char: "-" }]);
        expect(input.layout.modified.decorations.gutterMarkers).toEqual([{ line: 1, char: "+" }]);
        expect(input.layout.original.decorations.rangeBackgrounds?.length).toBeGreaterThan(0);
        expect(input.layout.modified.decorations.rangeBackgrounds?.[0]?.colorToken).toBe(
            "diffEditor.insertedTextBackground",
        );
    });

    it("чистая вставка не даёт original ни фонов, ни маркеров", () => {
        const input = layoutOf(["a", "c"], ["a", "b", "c"]);

        expect(input.layout.original.decorations.lineBackgrounds).toEqual([]);
        expect(input.layout.original.decorations.gutterMarkers).toEqual([]);
    });
});

describe("computeDiffV2Layout — свёртка unchanged", () => {
    it("скрытый кусок фолдится с заголовком-строкой над ним + парная плашка", () => {
        const original = [...lines(20), "x", ...lines(20, "t")];
        const modified = [...lines(20), "X", ...lines(20, "t")];
        const input = layoutOf(original, modified, true);

        const originalFolds = input.layout.original.foldingRegions;
        expect(originalFolds.length).toBeGreaterThan(0);
        expect(originalFolds.every((r) => r.isCollapsed)).toBe(true);
        // Плашки парные и подписаны.
        const originalPlaques = input.layout.original.decorations.zones?.filter((z) => z.text !== undefined) ?? [];
        const modifiedPlaques = input.layout.modified.decorations.zones?.filter((z) => z.text !== undefined) ?? [];
        expect(originalPlaques.length).toBe(modifiedPlaques.length);
        expect(originalPlaques.length).toBe(originalFolds.length);
        expect(originalPlaques[0]?.text).toContain("unchanged line");

        const counts = viewLineCounts(input);
        expect(counts.original).toBe(counts.modified);
    });

    it("кусок с начала файла: первая строка остаётся видимой, скрыт хвост куска", () => {
        const original = [...lines(30), "tail-x"];
        const modified = [...lines(30), "tail-X"];
        const input = layoutOf(original, modified, true);

        const fold = input.layout.original.foldingRegions[0];
        expect(fold.startLine).toBe(0);
        expect(fold.endLine).toBeGreaterThan(0);

        const counts = viewLineCounts(input);
        expect(counts.original).toBe(counts.modified);
    });

    it("без свёртки фолд-регионов нет", () => {
        const input = layoutOf(lines(40), [...lines(39), "CHANGED"]);

        expect(input.layout.original.foldingRegions).toEqual([]);
        expect(input.layout.modified.foldingRegions).toEqual([]);
    });
});

describe("computeDiffV2Layout — вырожденные регионы", () => {
    it("полностью раскрытый регион и регион-пустышка пропускаются", () => {
        const layout = computeDiffV2Layout(
            [],
            [
                {
                    originalStartLine: 0,
                    modifiedStartLine: 0,
                    lineCount: 10,
                    visibleTop: 0,
                    visibleBottom: 0,
                    hiddenLineCount: 0,
                },
                {
                    originalStartLine: 0,
                    modifiedStartLine: 0,
                    lineCount: 1,
                    visibleTop: 0,
                    visibleBottom: 0,
                    hiddenLineCount: 1,
                },
            ],
            new DiffInnerRanges([]),
            { original: 1, modified: 1 },
        );

        // Первый раскрыт (hidden 0), второй схлопнулся клампом (endLine <= header).
        expect(layout.original.foldingRegions).toEqual([]);
        expect(layout.modified.foldingRegions).toEqual([]);
    });
});

describe("computeDiffV2Layout — инвариант на смешанных диффах", () => {
    it("несколько блоков разной формы + свёртка: стороны равны по строкам вью", () => {
        const original = [...lines(10), "del1", "del2", "del3", ...lines(10, "m"), "x", ...lines(10, "t")];
        const modified = [...lines(10), "add1", ...lines(10, "m"), "X1", "X2", ...lines(10, "t")];
        const input = layoutOf(original, modified, true);

        const counts = viewLineCounts(input);
        expect(counts.original).toBe(counts.modified);
    });
});
