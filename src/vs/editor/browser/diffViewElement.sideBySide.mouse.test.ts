import { describe, expect, it } from "vitest";

import { Size } from "../../../../tuidom/common/geometryPromitives.ts";
import { TUIMouseEvent } from "../../../../tuidom/dom/events/tuiMouseEvent.ts";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { isSelectionCollapsed } from "../common/core/iSelection.ts";
import { DiffInnerRanges } from "../common/diff/diffInnerRanges.ts";
import type { IDiffViewRow } from "../common/diff/diffViewModel.ts";
import { createDiffViewState } from "../common/diff/diffViewText.ts";
import { buildSideBySideRows, createSideBySideViewStates } from "../common/diff/sideBySideRows.ts";
import { EMPTY_RESOLVED_TOKEN_STYLE } from "../common/languages/iTokenStyleResolver.ts";

import type { IDiffRowSource } from "./diffViewElement.ts";
import { DiffViewElement } from "./diffViewElement.ts";

const NO_TOKENS: IDiffRowSource = {
    getLineTokens: () => undefined,
    resolveTokenStyle: () => EMPTY_RESOLVED_TOKEN_STYLE,
};

/**
 * Дифф из четырёх строк вью (спаренных — трёх):
 *   0 unchanged  "keep one"     | "keep one"
 *   1 deleted    "removed word" | added "inserted word"  ← спарены
 *   2 collapsed  «⋯ 9 unchanged lines»
 */
const ROWS: IDiffViewRow[] = [
    { kind: "unchanged", originalLine: 0, modifiedLine: 0 },
    { kind: "deleted", originalLine: 1 },
    { kind: "added", modifiedLine: 1 },
    { kind: "collapsed", hiddenLineCount: 9, regionIndex: 0 },
];
const SIDES = {
    original: ["keep one", "removed word"],
    modified: ["keep one", "inserted word"],
};

const WIDTH = 41;

function createElement(): { element: DiffViewElement; app: TestApp } {
    const element = new DiffViewElement();
    element.sideBySideMinCols = 30;
    const sideRows = buildSideBySideRows(ROWS);
    element.setDiff({
        rows: ROWS,
        sideRows,
        source: NO_TOKENS,
        inlineViewState: createDiffViewState(ROWS, SIDES, 4),
        sideViewStates: createSideBySideViewStates(sideRows, SIDES, 4),
        labels: { original: "HEAD", modified: "file" },
        innerRanges: new DiffInnerRanges([]),
    });
    const app = TestApp.createWithContent(element, new Size(WIDTH, 6));
    app.render();
    return { element, app };
}

function mouseDown(
    element: DiffViewElement,
    localX: number,
    localY: number,
    options: { shiftKey?: boolean; button?: "left" | "right" } = {},
): void {
    element.dispatchEvent(
        new TUIMouseEvent("mousedown", {
            button: options.button ?? "left",
            screenX: localX,
            screenY: localY,
            localX,
            localY,
            shiftKey: options.shiftKey ?? false,
        }),
    );
}

function mouseMove(element: DiffViewElement, localX: number, localY: number): void {
    element.dispatchEvent(
        new TUIMouseEvent("mousemove", { button: "left", screenX: localX, screenY: localY, localX, localY }),
    );
}

function doubleClick(element: DiffViewElement, localX: number, localY: number, button: "left" | "right" = "left"): void {
    element.dispatchEvent(
        new TUIMouseEvent("dblclick", { button, screenX: localX, screenY: localY, localX, localY }),
    );
}

// Геометрия при WIDTH=41 и однозначных номерах: левая колонка 0..19 (текст с 5),
// разделитель 20, правая 21..40 (текст с 26). Заголовок — строка 0, текст — с 1.
const LEFT_TEXT_X = 5;
const RIGHT_TEXT_X = 26;

describe("DiffViewElement side-by-side — клик по сторонам (US-24)", () => {
    it("клик в правой колонке ставит каретку в modified", () => {
        const { element } = createElement();

        mouseDown(element, RIGHT_TEXT_X + 2, 1);

        expect(element.activeSide).toBe("modified");
        expect(element.viewState.selections[0].active).toEqual({ line: 0, character: 2 });
    });

    it("клик в левой колонке переключает активную сторону на original", () => {
        const { element } = createElement();

        mouseDown(element, LEFT_TEXT_X + 3, 2);

        expect(element.activeSide).toBe("original");
        expect(element.viewState.selections[0].active).toEqual({ line: 1, character: 3 });
    });

    it("клик по заголовку сторон каретку не трогает", () => {
        const { element } = createElement();
        const before = element.viewState.selections[0].active;

        mouseDown(element, LEFT_TEXT_X, 0);

        expect(element.viewState.selections[0].active).toEqual(before);
    });

    it("клик по гуттеру стороны — колонка 0 её строки", () => {
        const { element } = createElement();

        mouseDown(element, RIGHT_TEXT_X - 3, 1);

        expect(element.activeSide).toBe("modified");
        expect(element.viewState.selections[0].active).toEqual({ line: 0, character: 0 });
    });

    it("смена стороны схлопывает выделение прежней", () => {
        const { element } = createElement();
        mouseDown(element, RIGHT_TEXT_X, 1);
        mouseMove(element, RIGHT_TEXT_X + 6, 1);
        expect(isSelectionCollapsed(element.viewState.selections[0])).toBe(false);
        const modifiedState = element.viewState;

        mouseDown(element, LEFT_TEXT_X, 1);

        expect(element.activeSide).toBe("original");
        expect(isSelectionCollapsed(modifiedState.selections[0])).toBe(true);
    });
});

describe("DiffViewElement side-by-side — протяжка и копирование (US-26)", () => {
    it("протяжка не перетекает во вторую колонку: X клампится в колонку якоря", () => {
        const { element } = createElement();
        element.dispatchEvent(new TUIMouseEvent("mouseup", { button: "left", screenX: 0, screenY: 0, localX: 0, localY: 0 }));

        mouseDown(element, LEFT_TEXT_X, 2);
        // Утащили мышь глубоко в правую колонку — выделение осталось в original
        // и дотянулось лишь до конца её текстовой зоны.
        mouseMove(element, RIGHT_TEXT_X + 8, 2);

        expect(element.activeSide).toBe("original");
        const selection = element.viewState.selections[0];
        expect(selection.anchor).toEqual({ line: 1, character: 0 });
        expect(selection.active.line).toBe(1);
        expect(selection.active.character).toBeGreaterThan(0);
        expect(element.getSelectedText()).toBe(SIDES.original[1].slice(0, selection.active.character));
    });

    it("копирование отдаёт только текст своей стороны, без филлеров и плашек", () => {
        const { element } = createElement();
        // Выделить в правой стороне все три спаренные строки (включая плашку).
        mouseDown(element, RIGHT_TEXT_X, 1);
        mouseMove(element, RIGHT_TEXT_X + 13, 3);

        const text = element.getSelectedText();

        expect(text).toContain("keep one");
        expect(text).toContain("inserted word");
        expect(text).not.toContain("removed");
        expect(text).not.toContain("unchanged line");
    });

    it("выделение стороны с филлером выбрасывает строку-филлер целиком", () => {
        const { element } = createElement();
        // Дифф с филлером слева: удаление есть только в original.
        const rows: IDiffViewRow[] = [
            { kind: "unchanged", originalLine: 0, modifiedLine: 0 },
            { kind: "added", modifiedLine: 1 },
            { kind: "unchanged", originalLine: 1, modifiedLine: 2 },
        ];
        const sides = { original: ["top", "bottom"], modified: ["top", "mid", "bottom"] };
        const sideRows = buildSideBySideRows(rows);
        element.setDiff({
            rows,
            sideRows,
            source: NO_TOKENS,
            inlineViewState: createDiffViewState(rows, sides, 4),
            sideViewStates: createSideBySideViewStates(sideRows, sides, 4),
            labels: { original: "HEAD", modified: "file" },
            innerRanges: new DiffInnerRanges([]),
        });

        // Выделить в левой стороне все три строки вью (средняя — филлер).
        mouseDown(element, LEFT_TEXT_X, 1);
        mouseMove(element, LEFT_TEXT_X + 6, 3);

        expect(element.activeSide).toBe("original");
        expect(element.getSelectedText()).toBe("top\nbottom");
    });
});

describe("DiffViewElement side-by-side — двойной клик", () => {
    it("выделяет слово в правой стороне", () => {
        const { element } = createElement();

        doubleClick(element, RIGHT_TEXT_X + 1, 2);

        expect(element.activeSide).toBe("modified");
        const selection = element.viewState.selections[0];
        expect(selection.anchor).toEqual({ line: 1, character: 0 });
        expect(selection.active).toEqual({ line: 1, character: "inserted".length });
    });

    it("выделяет слово в левой стороне и переключает активную", () => {
        const { element } = createElement();

        doubleClick(element, LEFT_TEXT_X + 9, 2);

        expect(element.activeSide).toBe("original");
        const selection = element.viewState.selections[0];
        expect(selection.anchor).toEqual({ line: 1, character: "removed ".length });
        expect(selection.active).toEqual({ line: 1, character: "removed word".length });
    });

    it("по гуттеру и заголовку слова не выделяет", () => {
        const { element } = createElement();
        const before = element.viewState.selections[0].active;

        doubleClick(element, RIGHT_TEXT_X - 2, 2);
        doubleClick(element, LEFT_TEXT_X, 0);

        expect(element.viewState.selections[0].active).toEqual(before);
        expect(isSelectionCollapsed(element.viewState.selections[0])).toBe(true);
    });
});
