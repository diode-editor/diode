import { describe, expect, it } from "vitest";

import { createCursorSelection, createSelection } from "../core/iSelection.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

// Вьюпорт 10 колонок: "aaaa bbbb cccc" → ряды "aaaa bbbb " (offset 0..10) и "cccc".
function makeState(lines = "aaaa bbbb cccc\nshort", viewportWidth = 10): EditorViewState {
    const state = new EditorViewState(new TextDocument(lines), [createCursorSelection(0, 0)]);
    state.viewportWidth = viewportWidth;
    state.wordWrap = "on";
    return state;
}

function active(state: EditorViewState): { line: number; character: number } {
    const pos = state.selections[0].active;
    return { line: pos.line, character: pos.character };
}

describe("word wrap navigation — cursorUp/cursorDown по рядам", () => {
    it("cursorDown внутри перенесённой строки идёт на следующий фрагмент, держа колонку", () => {
        const state = makeState();
        state.selections = [createCursorSelection(0, 2)];
        state.cursorDown();
        // Колонка 2 фрагмента 2 → offset 10 + 2.
        expect(active(state)).toEqual({ line: 0, character: 12 });
        state.cursorDown();
        expect(active(state)).toEqual({ line: 1, character: 2 });
    });

    it("cursorUp с продолжения возвращается на первый фрагмент", () => {
        const state = makeState();
        state.selections = [createCursorSelection(0, 12)];
        state.cursorUp();
        expect(active(state)).toEqual({ line: 0, character: 2 });
    });

    it("липкая колонка переживает короткий фрагмент", () => {
        const state = makeState();
        state.selections = [createCursorSelection(0, 9)]; // колонка 9 первого фрагмента
        state.cursorDown(); // "cccc" — всего 4 колонки, каретка в конец
        expect(active(state)).toEqual({ line: 0, character: 14 });
        state.cursorUp(); // обратно — липкая колонка 9 восстановилась
        expect(active(state)).toEqual({ line: 0, character: 9 });
    });

    it("каретка на не-последнем фрагменте не переезжает границу при посадке", () => {
        // Вторая строка длинная: спуск с конца первого ряда не должен дать offset границы.
        const state = makeState("aaaa bbbb cccc\naaaa bbbb cccc");
        state.selections = [createCursorSelection(0, 14)]; // конец "cccc" (ряд 2)
        state.cursorDown(); // ряд 3 — первый фрагмент строки 1, колонка 4
        expect(active(state)).toEqual({ line: 1, character: 4 });
        state.selections = [createCursorSelection(0, 9)];
        state.cursorDown(); // ряд 2 ("cccc"): липкая колонка 9 клампится в конец строки
        expect(active(state)).toEqual({ line: 0, character: 14 });
    });

    it("у краёв вью каретка стоит на месте", () => {
        const state = makeState();
        state.selections = [createCursorSelection(0, 2)];
        state.cursorUp();
        expect(active(state)).toEqual({ line: 0, character: 2 });
        state.selections = [createCursorSelection(1, 3)];
        state.cursorDown();
        expect(active(state)).toEqual({ line: 1, character: 3 });
    });

    it("cursorDown проскакивает ряд-зону между строками", () => {
        const state = makeState();
        state.setViewZones([{ afterLine: 0, size: 1 }]);
        state.selections = [createCursorSelection(0, 12)]; // второй фрагмент
        state.cursorDown(); // через зону на "short"
        expect(active(state)).toEqual({ line: 1, character: 2 });
    });

    it("выделение Shift+Down тянется по фрагментам", () => {
        const state = makeState();
        state.selections = [createCursorSelection(0, 2)];
        state.cursorDown(true);
        const sel = state.selections[0];
        expect(sel.anchor).toEqual({ line: 0, character: 2 });
        expect(sel.active).toEqual({ line: 0, character: 12 });
    });
});

describe("word wrap navigation — Home/End по фрагменту", () => {
    it("Home на продолжении идёт к началу фрагмента, повторное нажатие — no-op", () => {
        const state = makeState();
        state.selections = [createCursorSelection(0, 12)];
        state.cursorHome();
        expect(active(state)).toEqual({ line: 0, character: 10 });
        state.cursorHome();
        expect(active(state)).toEqual({ line: 0, character: 10 });
    });

    it("Home на первом фрагменте — прежний smart home", () => {
        const state = makeState("  aaaa bbbb cccc\nz");
        state.selections = [createCursorSelection(0, 5)];
        state.cursorHome();
        expect(active(state)).toEqual({ line: 0, character: 2 });
        state.cursorHome();
        expect(active(state)).toEqual({ line: 0, character: 0 });
    });

    it("End на не-последнем фрагменте — последняя графема фрагмента", () => {
        const state = makeState();
        state.selections = [createCursorSelection(0, 2)];
        state.cursorEnd();
        // Граница фрагмента — offset 10; каретка перед нею, на пробеле (9).
        expect(active(state)).toEqual({ line: 0, character: 9 });
    });

    it("End на последнем фрагменте — конец строки", () => {
        const state = makeState();
        state.selections = [createCursorSelection(0, 12)];
        state.cursorEnd();
        expect(active(state)).toEqual({ line: 0, character: 14 });
    });
});

describe("word wrap navigation — по горизонтали через границы", () => {
    it("cursorRight в конце перенесённой строки уходит на СЛЕДУЮЩУЮ строку, а не на свой фрагмент", () => {
        const state = makeState();
        state.selections = [createCursorSelection(0, 14)];
        state.cursorRight();
        expect(active(state)).toEqual({ line: 1, character: 0 });
    });

    it("cursorLeft в начале строки уходит в конец предыдущей перенесённой", () => {
        const state = makeState();
        state.selections = [createCursorSelection(1, 0)];
        state.cursorLeft();
        expect(active(state)).toEqual({ line: 0, character: 14 });
    });
});

describe("word wrap navigation — мультикурсор и страницы", () => {
    it("insertCursorBelow добавляет каретку на следующий РЯД той же строки", () => {
        const state = makeState();
        state.selections = [createCursorSelection(0, 2)];
        state.insertCursorBelow();
        expect(state.selections.map((s) => ({ ...s.active }))).toEqual([
            { line: 0, character: 2 },
            { line: 0, character: 12 },
        ]);
    });

    it("insertCursorAbove с продолжения добавляет каретку на первый фрагмент", () => {
        const state = makeState();
        state.selections = [createCursorSelection(0, 12)];
        state.insertCursorAbove();
        expect(state.selections.map((s) => ({ ...s.active }))).toEqual([
            { line: 0, character: 2 },
            { line: 0, character: 12 },
        ]);
    });

    it("непустое выделение переезжает на соседний ряд целиком", () => {
        const state = makeState();
        state.selections = [createSelection(0, 0, 0, 2)];
        state.insertCursorBelow();
        expect(state.selections).toHaveLength(2);
        const added = state.selections[1];
        expect(added.anchor).toEqual({ line: 0, character: 10 });
        expect(added.active).toEqual({ line: 0, character: 12 });
    });

    it("PageDown шагает в рядах вью", () => {
        // 3 перенесённые строки по 2 ряда; вьюпорт 4 ряда → страница = 3 ряда.
        const state = makeState("aaaa bbbb cccc\naaaa bbbb cccc\naaaa bbbb cccc");
        state.viewportHeight = 4;
        state.selections = [createCursorSelection(0, 2)];
        state.cursorPageDown();
        // Ряд 0 → ряд 3 (второй фрагмент строки 1), колонка 2 → offset 12.
        expect(active(state)).toEqual({ line: 1, character: 12 });
    });

    it("PageUp с зоной перед началом вью откатывается к первому документному ряду ниже", () => {
        const state = makeState("aaaa bbbb cccc\nshort");
        state.viewportHeight = 3; // страница = 2 ряда
        state.setViewZones([{ afterLine: -1, size: 2 }]);
        state.selections = [createCursorSelection(0, 2)]; // ряд 2 (после двух рядов зоны)
        state.cursorPageUp(); // целевой ряд 0 — зона; выше документных нет — вниз к ряду 2
        expect(active(state)).toEqual({ line: 0, character: 2 });
    });

    it("cursorWordLeft в начале документа с зоной перед вью — no-op", () => {
        const state = makeState("aaaa bbbb cccc");
        state.setViewZones([{ afterLine: -1, size: 1 }]);
        state.selections = [createCursorSelection(0, 0)];
        state.cursorWordLeft();
        expect(active(state)).toEqual({ line: 0, character: 0 });
    });

    it("PageDown садится мимо зоны на ближайший документный ряд", () => {
        const state = makeState("aaaa bbbb cccc\nshort");
        state.viewportHeight = 3; // страница = 2 ряда
        state.setViewZones([{ afterLine: 0, size: 1 }]);
        state.selections = [createCursorSelection(0, 2)];
        state.cursorPageDown(); // ряд 0 + 2 = зона → откат к последнему документному выше
        expect(active(state)).toEqual({ line: 0, character: 12 });
    });
});

describe("word wrap navigation — reveal", () => {
    it("reveal показывает РЯД каретки: хвост длинной строки скроллит вьюпорт", () => {
        // 8 фрагментов по 10 колонок; вьюпорт 3 ряда.
        const state = makeState(`${"aaaa bbbb ".repeat(8)}end`, 10);
        state.viewportHeight = 3;
        state.goToPosition(0, 82);
        expect(state.scrollTop).toBeGreaterThan(0);
        expect(state.scrollLeft).toBe(0);
    });
});
