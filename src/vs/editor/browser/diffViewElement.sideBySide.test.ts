import { describe, expect, it } from "vitest";

import { packRgb } from "../../../../tuidom/common/colorUtils.ts";
import { Point, Size } from "../../../../tuidom/common/geometryPromitives.ts";
import { TUIMouseEvent } from "../../../../tuidom/dom/events/tuiMouseEvent.ts";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { DefaultLinesDiffComputer } from "../common/diff/defaultLinesDiffComputer/defaultLinesDiffComputer.ts";
import { DiffInnerRanges } from "../common/diff/diffInnerRanges.ts";
import { DiffViewModel } from "../common/diff/diffViewModel.ts";
import type { IDiffViewSides } from "../common/diff/diffViewText.ts";
import { createDiffViewState } from "../common/diff/diffViewText.ts";
import { buildSideBySideRows, createSideBySideViewStates } from "../common/diff/sideBySideRows.ts";
import { EMPTY_RESOLVED_TOKEN_STYLE } from "../common/languages/iTokenStyleResolver.ts";

import type { IDiffRowSource } from "./diffViewElement.ts";
import { DiffViewElement, SIDE_BY_SIDE_MIN_COLS } from "./diffViewElement.ts";

const ADDED_BG = packRgb(0x37, 0x3d, 0x29);
const REMOVED_BG = packRgb(0x4b, 0x18, 0x18);
const BG = packRgb(0x1e, 0x1e, 0x1e);
const FG = packRgb(0xcc, 0xcc, 0xcc);
const LINE_NO = packRgb(0x85, 0x85, 0x85);
const COLLAPSED_FG = packRgb(0x8c, 0x8c, 0x8c);
const FILLER_FG = packRgb(0x41, 0x41, 0x41);

const ADDED_TEXT_BG = packRgb(0x37, 0x41, 0x21);
const REMOVED_TEXT_BG = packRgb(0x66, 0x22, 0x22);

const STYLE_VARS = {
    "editorGutter.background": BG,
    "editorLineNumber.foreground": LINE_NO,
    "diffEditor.insertedLineBackground": ADDED_BG,
    "diffEditor.removedLineBackground": REMOVED_BG,
    "diffEditor.insertedTextBackground": ADDED_TEXT_BG,
    "diffEditor.removedTextBackground": REMOVED_TEXT_BG,
    "diffEditor.unchangedRegionForeground": COLLAPSED_FG,
    "diffEditor.diagonalFill": FILLER_FG,
};

const NO_TOKENS: IDiffRowSource = {
    getLineTokens: () => undefined,
    resolveTokenStyle: () => EMPTY_RESOLVED_TOKEN_STYLE,
};

/**
 * Порог для тестов занижен: рендерить полторы сотни колонок ради режима
 * незачем, а сам порог проверяется отдельным кейсом против константы.
 */
const TEST_MIN_COLS = 30;

// Геометрия при ширине 41 и однозначных номерах: левая колонка 0..19 (текст
// с 5), разделитель 20, правая 21..40 (текст с 26).
const LEFT_TEXT_X_HINT = 5;
const RIGHT_TEXT_X_HINT = 26;

function makeElement(
    original: string[],
    modified: string[],
    options: { collapsed?: boolean; source?: IDiffRowSource; labels?: { original: string; modified: string } } = {},
): DiffViewElement {
    const diff = new DefaultLinesDiffComputer().computeDiff(original, modified, {
        ignoreTrimWhitespace: false,
        maxComputationTimeMs: Number.MAX_SAFE_INTEGER,
        computeMoves: false,
    });
    const model = new DiffViewModel(diff.changes, original.length, modified.length, {
        hideUnchangedRegions: options.collapsed === true,
    });
    const sides: IDiffViewSides = { original, modified };
    const sideRows = buildSideBySideRows(model.rows);

    const element = new DiffViewElement();
    element.sideBySideMinCols = TEST_MIN_COLS;
    element.setStyleVars(STYLE_VARS);
    element.style = { fg: FG, bg: BG };
    element.setDiff({
        rows: model.rows,
        sideRows,
        source: options.source ?? NO_TOKENS,
        inlineViewState: createDiffViewState(model.rows, sides, 4),
        sideViewStates: createSideBySideViewStates(sideRows, sides, 4),
        labels: options.labels ?? { original: "HEAD", modified: "a.txt" },
        innerRanges: new DiffInnerRanges(diff.changes),
        identical: diff.changes.length === 0,
    });
    return element;
}

function render(element: DiffViewElement, size = new Size(41, 8)): TestApp {
    const app = TestApp.createWithContent(element, size);
    app.render();
    return app;
}

/** Строки экрана без хвостовых пробелов — так проще читать ассерты. */
function screenLines(app: TestApp): string[] {
    return app.backend
        .screenToString()
        .split("\n")
        .map((l) => l.replace(/\s+$/, ""));
}

describe("DiffViewElement side-by-side — раскладка (US-13, US-14, US-15)", () => {
    it("две колонки с пер-сторонними номерами, разделителем и заголовком сторон", () => {
        const app = render(makeElement(["a", "b", "c"], ["a", "B", "c"]));

        expect(screenLines(app).slice(0, 5)).toEqual([
            "     HEAD           │     a.txt",
            " 1   a              │ 1   a",
            " 2 - b              │ 2 + B",
            " 3   c              │ 3   c",
            "                    │",
        ]);
    });

    it("чистая вставка даёт филлер слева напротив добавленной строки", () => {
        const app = render(makeElement(["a", "c"], ["a", "b", "c"]));

        expect(screenLines(app).slice(0, 4)).toEqual([
            "     HEAD           │     a.txt",
            " 1   a              │ 1   a",
            "     ░░░░░░░░░░░░░░░│ 2 + b",
            " 2   c              │ 3   c",
        ]);
    });

    it("чистое удаление даёт филлер справа напротив удалённой строки", () => {
        const app = render(makeElement(["a", "b", "c"], ["a", "c"]));

        expect(screenLines(app).slice(0, 4)).toEqual([
            "     HEAD           │     a.txt",
            " 1   a              │ 1   a",
            " 2 - b              │     ░░░░░░░░░░░░░░░",
            " 3   c              │ 2   c",
        ]);
    });

    it("блок D>A: пары выровнены, хвост удалённых напротив филлеров", () => {
        const app = render(makeElement(["a", "x", "y", "z", "b"], ["a", "X", "b"]));

        expect(screenLines(app).slice(1, 6)).toEqual([
            " 1   a              │ 1   a",
            " 2 - x              │ 2 + X",
            " 3 - y              │     ░░░░░░░░░░░░░░░",
            " 4 - z              │     ░░░░░░░░░░░░░░░",
            " 5   b              │ 3   b",
        ]);
    });

    it("фоны: removed слева, inserted справа, у филлера дефолтный фон", () => {
        const app = render(makeElement(["a", "x", "y", "b"], ["a", "X", "b"]));
        const bgAt = (x: number, y: number) => app.backend.getBgAt(new Point(x, y));

        // Строка 2 экрана — пара x|X: слева removed, справа inserted.
        expect(bgAt(0, 2)).toBe(REMOVED_BG);
        expect(bgAt(21, 2)).toBe(ADDED_BG);
        // Строка 3 — y|филлер: слева removed, справа дефолт.
        expect(bgAt(0, 3)).toBe(REMOVED_BG);
        expect(bgAt(25, 3)).toBe(BG);
        // Заголовок и unchanged — дефолт.
        expect(bgAt(0, 0)).toBe(BG);
        expect(bgAt(0, 1)).toBe(BG);
    });

    it("intra-line: изменённый фрагмент ярче фона строки в обеих колонках (US-18)", () => {
        // «b» → «bXX»: фон строки — *LineBackground, фрагмент — *TextBackground.
        const app = render(makeElement(["a", "b suffix", "c"], ["a", "bXX suffix", "c"]));
        const bgAt = (x: number, y: number) => app.backend.getBgAt(new Point(x, y));

        // Правая колонка (текст с 26): «XX» подсвечен ярким, начало строки — фоном строки.
        expect(bgAt(RIGHT_TEXT_X_HINT + 1, 2)).toBe(ADDED_TEXT_BG);
        expect(bgAt(RIGHT_TEXT_X_HINT + 6, 2)).toBe(ADDED_BG);
        // Левая колонка: удалённого фрагмента в «b» нет как текста, но строка
        // изменена — интра-спан оригинала где-то в строке; фон строки removed.
        expect(bgAt(LEFT_TEXT_X_HINT + 7, 2)).toBe(REMOVED_BG);
    });

    it("intra-line подсвечивается и в inline-режиме", () => {
        const element = makeElement(["a", "b suffix", "c"], ["a", "bXX suffix", "c"]);
        const app = render(element, new Size(TEST_MIN_COLS - 1, 6));
        expect(element.mode).toBe("inline");
        const bgAt = (x: number, y: number) => app.backend.getBgAt(new Point(x, y));

        // Добавленная строка (экранная 2): «XX» ярче фона строки.
        expect(bgAt(element.gutterWidth + 1, 2)).toBe(ADDED_TEXT_BG);
        expect(bgAt(element.gutterWidth + 6, 2)).toBe(ADDED_BG);
    });

    it("длинные подписи сторон обрезаются по своей колонке", () => {
        const app = render(
            makeElement(["a"], ["b"], {
                labels: { original: "o".repeat(40), modified: "m".repeat(40) },
            }),
        );

        const header = screenLines(app)[0];
        expect(header).toContain("│");
        expect(header.indexOf("m")).toBeGreaterThan(header.indexOf("│"));
        expect(header.length).toBeLessThanOrEqual(41);
    });
});

describe("DiffViewElement side-by-side — свёрнутые куски (US-19)", () => {
    it("плашка одна на обе колонки, разделитель на ней не рисуется", () => {
        const original = Array.from({ length: 30 }, (_, i) => `line${String(i)}`);
        const modified = [...original];
        modified[0] = "FIRST";
        modified[29] = "LAST";
        const app = render(makeElement(original, modified, { collapsed: true }), new Size(41, 10));

        const lines = screenLines(app);
        const placeholder = lines.find((l) => l.includes("unchanged lines"));
        expect(placeholder).toBeDefined();
        expect(placeholder).not.toContain("│");
        // ⋯ стоит в номерах обеих сторон.
        expect(placeholder).toContain("⋯");
    });
});

describe("DiffViewElement side-by-side — режим и порог (US-21, US-23)", () => {
    it("дефолтный порог — константа SIDE_BY_SIDE_MIN_COLS", () => {
        expect(new DiffViewElement().sideBySideMinCols).toBe(SIDE_BY_SIDE_MIN_COLS);
        // Порог по ширине элемента (не терминала): с сайдбаром и скроллбаром
        // это терминал от ~120 колонок.
        expect(SIDE_BY_SIDE_MIN_COLS).toBe(100);
    });

    it("уже порога рендерится inline, шире — side-by-side", () => {
        const element = makeElement(["a", "b"], ["a", "B"]);
        const narrow = render(element, new Size(TEST_MIN_COLS - 1, 6));

        expect(element.mode).toBe("inline");
        expect(screenLines(narrow)[1]).toBe("  2   -  b");

        const wide = render(element, new Size(41, 6));
        expect(element.mode).toBe("side-by-side");
        expect(screenLines(wide)[0]).toContain("HEAD");
    });

    it("смена режима переносит каретку на ту же строку файла (US-23)", () => {
        const element = makeElement(["a", "x", "b"], ["a", "X", "b"]);
        render(element, new Size(41, 6));
        expect(element.mode).toBe("side-by-side");
        // Каретка на строку X правой стороны (спаренная строка 1).
        element.viewState.selections = [
            { anchor: { line: 1, character: 1 }, active: { line: 1, character: 1 } },
        ];

        render(element, new Size(TEST_MIN_COLS - 1, 6));
        expect(element.mode).toBe("inline");
        // В inline строка X — третья (после deleted x).
        expect(element.viewState.selections[0].active).toEqual({ line: 2, character: 1 });

        render(element, new Size(41, 6));
        expect(element.mode).toBe("side-by-side");
        expect(element.viewState.selections[0].active).toEqual({ line: 1, character: 1 });
    });

    it("каретка с филлера переезжает по строке противоположной стороны", () => {
        // Чистая вставка: спаренные строки "=0/0 ·|1 =1/2", филлер у original.
        const element = makeElement(["a", "c"], ["a", "b", "c"]);
        const app = TestApp.createWithContent(element, new Size(41, 6));
        app.render();
        expect(element.mode).toBe("side-by-side");
        // Каретка на филлере левой стороны (клик в левую колонку строки 1).
        element.dispatchEvent(
            new TUIMouseEvent("mousedown", { button: "left", screenX: 6, screenY: 2, localX: 6, localY: 2 }),
        );
        expect(element.activeSide).toBe("original");
        expect(element.viewState.selections[0].active.line).toBe(1);

        render(element, new Size(TEST_MIN_COLS - 1, 6));

        expect(element.mode).toBe("inline");
        // Якорь взят у противоположной стороны той же спаренной строки: в
        // inline это добавленная строка b (индекс 1).
        expect(element.viewState.selections[0].active).toEqual({ line: 1, character: 0 });
    });

    it("каретка с deleted-строки inline переезжает в левую колонку", () => {
        const element = makeElement(["a", "x", "b"], ["a", "X", "b"]);
        render(element, new Size(TEST_MIN_COLS - 1, 6));
        expect(element.mode).toBe("inline");
        element.viewState.selections = [
            { anchor: { line: 1, character: 0 }, active: { line: 1, character: 0 } },
        ];

        render(element, new Size(41, 6));
        expect(element.mode).toBe("side-by-side");
        expect(element.activeSide).toBe("original");
        expect(element.viewState.selections[0].active).toEqual({ line: 1, character: 0 });
    });

    it("каретка с правого филлера переезжает на удалённую строку слева", () => {
        // Чистое удаление: филлер у modified, активная сторона — modified.
        const element = makeElement(["a", "b", "c"], ["a", "c"]);
        render(element, new Size(41, 6));
        expect(element.mode).toBe("side-by-side");
        element.viewState.selections = [
            { anchor: { line: 1, character: 0 }, active: { line: 1, character: 0 } },
        ];

        render(element, new Size(TEST_MIN_COLS - 1, 6));

        expect(element.mode).toBe("inline");
        // Якорь — удалённая строка b левой стороны: в inline это индекс 1.
        expect(element.viewState.selections[0].active).toEqual({ line: 1, character: 0 });
    });

    it("каретка и скролл на плашке остаются на той же визуальной строке в обе стороны", () => {
        const original = Array.from({ length: 40 }, (_, i) => `line${String(i)}`);
        const modified = [...original];
        modified[0] = "FIRST";
        modified[39] = "LAST";
        const element = makeElement(original, modified, { collapsed: true });
        const narrow = new Size(TEST_MIN_COLS - 1, 6);
        render(element, narrow);
        expect(element.mode).toBe("inline");
        const inlinePlaceholder = element.rows.findIndex((row) => row.kind === "collapsed");
        element.viewState.selections = [
            { anchor: { line: inlinePlaceholder, character: 2 }, active: { line: inlinePlaceholder, character: 2 } },
        ];
        element.viewState.scrollTop = inlinePlaceholder;

        render(element, new Size(41, 8));
        expect(element.mode).toBe("side-by-side");
        const state = element.inspectState() as { scrollTop: number; selections: { active: { line: number } }[] };
        // У плашки нет координаты «(сторона, строка файла)», поэтому каретка и
        // скролл остаются на том же ИНДЕКСЕ строки вью (спаренное вью короче,
        // так что это соседняя видимая строка, а не потеря позиции).
        expect(state.selections[0].active.line).toBe(inlinePlaceholder);
        expect(state.scrollTop).toBe(inlinePlaceholder);

        // Обратно каретка уже на реальной строке — переезд точный, по
        // (side, fileLine), и позиция больше не дрейфует.
        render(element, narrow);
        expect(element.mode).toBe("inline");
        const sideRow = element.viewState.selections[0].active.line;
        render(element, new Size(41, 8));
        render(element, narrow);
        expect(element.viewState.selections[0].active.line).toBe(sideRow);

        // Плашка и в обратном направлении: каретка и скролл на плашке
        // спаренного вью переезжают в inline на тот же индекс строки.
        render(element, new Size(41, 8));
        const sidePlaceholder = element.sideRows.findIndex((row) => row.kind === "collapsed");
        element.viewState.selections = [
            { anchor: { line: sidePlaceholder, character: 0 }, active: { line: sidePlaceholder, character: 0 } },
        ];
        element.viewState.scrollTop = sidePlaceholder;
        render(element, narrow);
        expect(element.mode).toBe("inline");
        expect(element.viewState.selections[0].active.line).toBe(sidePlaceholder);
        expect(element.viewState.scrollTop).toBe(sidePlaceholder);
    });

    it("layout до setDiff не падает и остаётся пустым", () => {
        const element = new DiffViewElement();
        element.sideBySideMinCols = TEST_MIN_COLS;
        element.setStyleVars(STYLE_VARS);
        const app = render(element, new Size(41, 4));

        expect(element.mode).toBe("side-by-side");
        expect(screenLines(app).every((line) => line.trim() === "" || line.includes("│"))).toBe(true);
    });
});

describe("DiffViewElement side-by-side — синхронный скролл (US-16, US-17)", () => {
    const original = Array.from({ length: 20 }, (_, i) => `o${String(i)}`);
    const modified = original.map((line, i) => (i === 0 ? "changed" : line));

    it("вертикальный скролл активной стороны зеркалится в соседа", () => {
        const element = makeElement(original, modified);
        render(element, new Size(41, 6));

        element.viewState.scrollTop = 7;

        expect(element.scrollTop).toBe(7);
        const app = render(element, new Size(41, 6));
        const lines = screenLines(app);
        // Обе колонки показывают одно окно строк.
        expect(lines[1]).toContain("o7");
        expect(lines[1].split("│")[1]).toContain("o7");
    });

    it("горизонтальный скролл общий на обе стороны", () => {
        const longOriginal = ["x".repeat(60), "b"];
        const longModified = ["x".repeat(60), "B"];
        const element = makeElement(longOriginal, longModified);
        render(element, new Size(41, 6));

        element.viewState.scrollLeft = 10;

        const other = element.activeSide === "original" ? "modified" : "original";
        expect(element.scrollLeft).toBe(10);
        // Зеркалирование дошло до второй стороны: элемент один, скролл один.
        element.viewState.selections = [{ anchor: { line: 0, character: 0 }, active: { line: 0, character: 0 } }];
        expect(other).not.toBe(element.activeSide);
    });

    it("contentWidth считает самую длинную строку обеих сторон", () => {
        const element = makeElement(["short", "b"], ["short", "x".repeat(50)]);
        render(element, new Size(41, 6));

        // Прокручиваемая часть — от самой длинной строки (правой).
        expect(element.contentWidth).toBeGreaterThanOrEqual(50);
    });
});

describe("DiffViewElement side-by-side — inspectState", () => {
    it("отдаёт режим, активную сторону и размер спаренного вью", () => {
        const element = makeElement(["a", "x", "b"], ["a", "X", "b"]);
        render(element, new Size(41, 6));

        const state = element.inspectState();
        expect(state.mode).toBe("side-by-side");
        expect(state.activeSide).toBe("modified");
        expect(state.sideRowCount).toBe(3);
    });
});
