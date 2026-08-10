import { describe, expect, it } from "vitest";

import { Size } from "../../../../tuidom/common/geometryPromitives.ts";
import { TUIMouseEvent } from "../../../../tuidom/dom/events/tuiMouseEvent.ts";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { isSelectionCollapsed } from "../common/core/iSelection.ts";
import type { IDiffViewRow } from "../common/diff/diffViewModel.ts";
import { createDiffViewState } from "../common/diff/diffViewText.ts";
import { EMPTY_RESOLVED_TOKEN_STYLE } from "../common/languages/iTokenStyleResolver.ts";

import type { IDiffRowSource } from "./diffViewElement.ts";
import { DiffViewElement } from "./diffViewElement.ts";

const NO_TOKENS: IDiffRowSource = {
    getLineTokens: () => undefined,
    resolveTokenStyle: () => EMPTY_RESOLVED_TOKEN_STYLE,
};

const ROWS: IDiffViewRow[] = [
    { kind: "unchanged", originalLine: 0, modifiedLine: 0 },
    { kind: "deleted", originalLine: 1 },
    { kind: "added", modifiedLine: 1 },
];
const SIDES = {
    original: ["alpha  beta", "removed one"],
    modified: ["alpha  beta", "inserted two"],
};

function createElement(): { element: DiffViewElement; app: TestApp } {
    const element = new DiffViewElement();
    element.setRows(ROWS, NO_TOKENS, createDiffViewState(ROWS, SIDES, 4));
    const app = TestApp.createWithContent(element, new Size(40, 5));
    app.render();
    return { element, app };
}

function mouseDown(element: DiffViewElement, localX: number, localY: number, options: { shiftKey?: boolean; button?: "left" | "right" } = {}): void {
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
        new TUIMouseEvent("mousemove", {
            button: "none",
            screenX: localX,
            screenY: localY,
            localX,
            localY,
        }),
    );
}

function mouseUp(element: DiffViewElement): void {
    element.dispatchEvent(
        new TUIMouseEvent("mouseup", { button: "left", screenX: 0, screenY: 0, localX: 0, localY: 0 }),
    );
}

function doubleClick(element: DiffViewElement, localX: number, localY: number): void {
    element.dispatchEvent(
        new TUIMouseEvent("dblclick", {
            button: "left",
            screenX: localX,
            screenY: localY,
            localX,
            localY,
        }),
    );
}

const active = (element: DiffViewElement) => element.viewState.selections[0].active;

describe("DiffViewElement — мышь", () => {
    it("клик ставит каретку туда, куда кликнули", () => {
        const { element } = createElement();

        mouseDown(element, element.gutterWidth + 6, 2);

        expect(active(element)).toEqual({ line: 2, character: 6 });
        expect(isSelectionCollapsed(element.viewState.selections[0])).toBe(true);
    });

    it("клик по любой зоне гуттера схлопывает позицию в начало строки", () => {
        const { element } = createElement();

        // Номер оригинала, номер изменённого, маркер, отступ — всё колонка 0.
        for (const x of [0, 2, 4, 6, element.gutterWidth - 1]) {
            mouseDown(element, x, 1);
            expect(active(element)).toEqual({ line: 1, character: 0 });
        }
    });

    it("клик ниже последней строки прижимается к ней, а не уезжает за конец", () => {
        const { element } = createElement();

        mouseDown(element, element.gutterWidth, 4);

        expect(active(element).line).toBe(ROWS.length - 1);
    });

    it("правая кнопка каретку не двигает", () => {
        const { element } = createElement();
        mouseDown(element, element.gutterWidth + 3, 0);

        mouseDown(element, element.gutterWidth + 7, 2, { button: "right" });

        expect(active(element)).toEqual({ line: 0, character: 3 });
    });

    it("протяжка мышью выделяет от места нажатия", () => {
        const { element } = createElement();

        mouseDown(element, element.gutterWidth + 2, 0);
        mouseMove(element, element.gutterWidth + 5, 2);

        expect(element.viewState.selections[0]).toEqual({
            anchor: { line: 0, character: 2 },
            active: { line: 2, character: 5 },
        });
        expect(element.getSelectedText()).toBe("pha  beta\nremoved one\ninser");
    });

    it("после отпускания кнопки движение мыши уже не выделяет", () => {
        const { element } = createElement();
        mouseDown(element, element.gutterWidth + 2, 0);
        mouseUp(element);

        mouseMove(element, element.gutterWidth + 9, 2);

        expect(isSelectionCollapsed(element.viewState.selections[0])).toBe(true);
    });

    it("Shift+клик расширяет выделение от прежнего якоря", () => {
        const { element } = createElement();
        mouseDown(element, element.gutterWidth + 1, 0);

        mouseDown(element, element.gutterWidth + 4, 1, { shiftKey: true });

        expect(element.viewState.selections[0]).toEqual({
            anchor: { line: 0, character: 1 },
            active: { line: 1, character: 4 },
        });
    });

    it("двойной клик выделяет слово под курсором", () => {
        const { element } = createElement();

        // "alpha  beta" — клик по второму слову.
        doubleClick(element, element.gutterWidth + 7, 0);

        expect(element.getSelectedText()).toBe("beta");
    });

    it("двойной клик по гуттеру слово не выделяет", () => {
        const { element } = createElement();

        doubleClick(element, 1, 0);

        expect(isSelectionCollapsed(element.viewState.selections[0])).toBe(true);
    });

    it("двойной клик по пробелу каретку не трогает", () => {
        const { element } = createElement();
        // Колонка 6 — второй пробел подряд: слева и справа не слово, поэтому
        // findWordRangeAt не за что зацепиться (у одиночного пробела он
        // якорится на слово слева — это поведение редактора, не баг).
        mouseDown(element, element.gutterWidth + 6, 0);

        doubleClick(element, element.gutterWidth + 6, 0);

        expect(isSelectionCollapsed(element.viewState.selections[0])).toBe(true);
    });

    it("двойной клик правой кнопкой игнорируется", () => {
        const { element } = createElement();

        element.dispatchEvent(
            new TUIMouseEvent("dblclick", {
                button: "right",
                screenX: element.gutterWidth + 7,
                screenY: 0,
                localX: element.gutterWidth + 7,
                localY: 0,
            }),
        );

        expect(isSelectionCollapsed(element.viewState.selections[0])).toBe(true);
    });
});
