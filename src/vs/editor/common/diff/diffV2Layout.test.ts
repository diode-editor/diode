import { describe, expect, it } from "vitest";

import { TextDocument } from "../model/textDocument.ts";
import { EditorViewState } from "../viewModel/editorViewState.ts";

import { DefaultLinesDiffComputer } from "./defaultLinesDiffComputer/defaultLinesDiffComputer.ts";
import { DiffInnerRanges } from "./diffInnerRanges.ts";
import {
    computeDiffV2Layout,
    computeInlineLayout,
    DIFF_FILLER_CHAR,
    mergeZoneDecorationsByAnchor,
} from "./diffV2Layout.ts";
import { DiffViewModel } from "./diffViewModel.ts";

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

describe("computeInlineLayout — один редактор с зонами-призраками (PR-6)", () => {
    function inlineOf(original: string[], modified: string[], collapsed = false) {
        const diff = COMPUTER.computeDiff(original, modified, {
            ignoreTrimWhitespace: false,
            maxComputationTimeMs: Number.MAX_SAFE_INTEGER,
            computeMoves: false,
        });
        const model = new DiffViewModel(diff.changes, original.length, modified.length, {
            hideUnchangedRegions: collapsed,
        });
        return computeInlineLayout(
            diff.changes,
            model.regions,
            new DiffInnerRanges(diff.changes),
            modified.length,
            original,
        );
    }

    it("призрак с текстом удалённых строк встаёт перед своим ганком", () => {
        const layout = inlineOf(["keep", "dead1", "dead2", "tail"], ["keep", "live", "tail"]);

        const ghost = layout.decorations.zones?.find((zone) => zone.lines !== undefined);
        expect(ghost?.afterLine).toBe(0); // после строки перед ганком
        expect(ghost?.lines?.map((line) => line.text)).toEqual(["dead1", "dead2"]);
        expect(ghost?.lines?.every((line) => line.bgToken === "diffEditor.removedLineBackground")).toBe(true);
        expect(layout.zones.find((zone) => zone.afterLine === 0)?.size).toBe(2);
        // Добавленная строка помечена как в side-by-side.
        expect(layout.decorations.gutterMarkers).toEqual([{ line: 1, char: "+" }]);
        expect(layout.decorations.lineBackgrounds).toEqual([
            { startLine: 1, endLine: 1, colorToken: "diffEditor.insertedLineBackground" },
        ]);
    });

    it("чистая вставка — без призрака; чистое удаление — призрак без маркеров", () => {
        const inserted = inlineOf(["a", "b"], ["a", "NEW", "b"]);
        expect(inserted.decorations.zones?.some((zone) => zone.lines !== undefined)).toBe(false);
        expect(inserted.decorations.gutterMarkers).toEqual([{ line: 1, char: "+" }]);

        const removed = inlineOf(["a", "gone", "b"], ["a", "b"]);
        const ghost = removed.decorations.zones?.find((zone) => zone.lines !== undefined);
        expect(ghost?.lines?.map((line) => line.text)).toEqual(["gone"]);
        expect(removed.decorations.gutterMarkers).toEqual([]);
    });

    it("ганк в начале файла — призрак перед первой строкой (якорь -1)", () => {
        const layout = inlineOf(["gone", "keep"], ["keep"]);
        const ghost = layout.decorations.zones?.find((zone) => zone.lines !== undefined);
        expect(ghost?.afterLine).toBe(-1);
    });

    it("свёртка unchanged — по modified-координатам, плашка одиночная", () => {
        const base = Array.from({ length: 30 }, (_, i) => `line${String(i)}`);
        const layout = inlineOf(base, ["X", ...base.slice(1)], true);

        expect(layout.foldingRegions.length).toBeGreaterThan(0);
        const plaque = layout.decorations.zones?.find((zone) => zone.text?.includes("unchanged"));
        expect(plaque).toBeDefined();
    });

    it("идентичные стороны — нотис-зона перед первой строкой", () => {
        const layout = inlineOf(["same"], ["same"]);
        expect(layout.decorations.zones?.[0]?.text).toBe("The files are identical");
        expect(layout.zones).toEqual([{ afterLine: -1, size: 1 }]);
    });

    it("intra-line диапазоны modified доезжают до inline-раскладки", () => {
        const layout = inlineOf(["const a = 1;"], ["const a = 2;"]);
        expect(layout.decorations.rangeBackgrounds?.length).toBeGreaterThan(0);
        expect(layout.decorations.rangeBackgrounds?.[0].colorToken).toBe("diffEditor.insertedTextBackground");
    });
});

describe("computeInlineLayout — вырожденные регионы", () => {
    it("регион-пустышка и регион без скрываемого тела пропускаются", () => {
        const layout = computeInlineLayout(
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
                    lineCount: 2,
                    visibleTop: 0,
                    visibleBottom: 1,
                    hiddenLineCount: 1,
                },
            ],
            new DiffInnerRanges([]),
            1,
            ["same"],
        );

        expect(layout.foldingRegions).toEqual([]);
    });
});

describe("mergeZoneDecorationsByAnchor", () => {
    it("одиночные декорации проходят как есть, общий якорь склеивается в lines", () => {
        const merged = mergeZoneDecorationsByAnchor([
            { afterLine: 2, text: "⋯ 5 unchanged lines", colorToken: "diffEditor.unchangedRegionForeground" },
            { afterLine: 2, lines: [{ text: "ghost", bgToken: "diffEditor.removedLineBackground" }] },
            { afterLine: 7, fillChar: "░" },
        ]);

        expect(merged).toHaveLength(2);
        const combined = merged.find((zone) => zone.afterLine === 2);
        // Плашка — первой строкой (порядок массива = порядок строк зоны).
        expect(combined?.lines?.map((line) => line.text)).toEqual(["⋯ 5 unchanged lines", "ghost"]);
        expect(combined?.lines?.[0].colorToken).toBe("diffEditor.unchangedRegionForeground");
        expect(combined?.lines?.[1].bgToken).toBe("diffEditor.removedLineBackground");
        expect(merged.find((zone) => zone.afterLine === 7)?.fillChar).toBe("░");
    });

    it("в склейке текст без цвета и филлер без текста не рождают строк-мусора", () => {
        const merged = mergeZoneDecorationsByAnchor([
            { afterLine: 3, text: "plain" },
            { afterLine: 3, fillChar: "░" },
        ]);

        expect(merged).toHaveLength(1);
        expect(merged[0].lines).toEqual([{ text: "plain" }]);
    });
});
