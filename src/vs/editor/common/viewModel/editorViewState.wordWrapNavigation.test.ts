import { describe, expect, it } from "vitest";

import { createCursorSelection, createSelection } from "../core/iSelection.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

// Viewport of 10 columns: "aaaa bbbb cccc" → rows "aaaa bbbb " (offset 0..10) and "cccc".
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
        // Column 2 of fragment 2 → offset 10 + 2.
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
        state.selections = [createCursorSelection(0, 9)];
        state.cursorDown(); // "cccc" is only 4 columns, cursor goes to the end
        expect(active(state)).toEqual({ line: 0, character: 14 });
        state.cursorUp();
        expect(active(state)).toEqual({ line: 0, character: 9 });
    });

    it("каретка на не-последнем фрагменте не переезжает границу при посадке", () => {
        // The second line is long: going down from the end of the first row must not yield the boundary offset.
        const state = makeState("aaaa bbbb cccc\naaaa bbbb cccc");
        state.selections = [createCursorSelection(0, 14)]; // end of "cccc" (row 2)
        state.cursorDown();
        expect(active(state)).toEqual({ line: 1, character: 4 });
        state.selections = [createCursorSelection(0, 9)];
        state.cursorDown(); // row 2 ("cccc"): sticky column 9 clamps to the line end
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
        state.selections = [createCursorSelection(0, 12)]; // second fragment
        state.cursorDown();
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

describe("word wrap navigation — скрытые строки и зоны", () => {
    it("cursorUp со скрытой строки садится на ПЕРВУЮ строку документа, если она ближайшая видимая", () => {
        const state = makeState("head\nhidden\ntail");
        state.setFoldingRegions([{ startLine: 0, endLine: 1, isCollapsed: true }]);
        // Cursor on a hidden line — bypassing reconcileHiddenCursors.
        state.selections = [createCursorSelection(1, 2)];
        state.cursorUp();
        expect(active(state)).toEqual({ line: 0, character: 2 });
    });

    it("cursorRight в конце строки проскакивает зону и уходит на следующую строку", () => {
        const state = makeState("ab\ncd");
        state.setViewZones([{ afterLine: 0, size: 1 }]);
        state.selections = [createCursorSelection(0, 2)];
        state.cursorRight();
        expect(active(state)).toEqual({ line: 1, character: 0 });
    });

    it("посадка с липкой колонкой за границей фрагмента клампится к последней графеме", () => {
        const state = makeState("short\naaaa bbbb cccc");
        state.selections = [createCursorSelection(0, 5)];
        state.cursorEnd();
        state.cursorDown(); // row 1 — NOT the last fragment of line 1
        expect(active(state)).toEqual({ line: 1, character: 9 });
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
        // The fragment boundary is offset 10; the cursor is before it, on the space (9).
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
        // 3 wrapped lines of 2 rows each; viewport of 4 rows → page = 3 rows.
        const state = makeState("aaaa bbbb cccc\naaaa bbbb cccc\naaaa bbbb cccc");
        state.viewportHeight = 4;
        state.selections = [createCursorSelection(0, 2)];
        state.cursorPageDown();
        // Row 0 → row 3 (second fragment of line 1), column 2 → offset 12.
        expect(active(state)).toEqual({ line: 1, character: 12 });
    });

    it("PageUp с зоной перед началом вью откатывается к первому документному ряду ниже", () => {
        const state = makeState("aaaa bbbb cccc\nshort");
        state.viewportHeight = 3; // page = 2 rows
        state.setViewZones([{ afterLine: -1, size: 2 }]);
        state.selections = [createCursorSelection(0, 2)]; // row 2 (after the zone's two rows)
        state.cursorPageUp(); // target row 0 is a zone; no document rows above — down to row 2
        expect(active(state)).toEqual({ line: 0, character: 2 });
    });

    it("cursorWordLeft в начале документа с зоной перед вью — no-op", () => {
        const state = makeState("aaaa bbbb cccc");
        state.setViewZones([{ afterLine: -1, size: 1 }]);
        state.selections = [createCursorSelection(0, 0)];
        state.cursorWordLeft();
        expect(active(state)).toEqual({ line: 0, character: 0 });
    });

    it("PageUp с ряда-продолжения держит колонку относительно фрагмента", () => {
        const state = makeState();
        state.viewportHeight = 2; // page = 1 row
        state.selections = [createCursorSelection(0, 12)]; // row 1, column 2 of the fragment
        state.cursorPageUp();
        expect(active(state)).toEqual({ line: 0, character: 2 });
    });

    it("PageUp на зону, чей ближайший документный ряд — самый первый", () => {
        const state = makeState("ab\ncd");
        state.viewportHeight = 2; // page = 1 row
        state.setViewZones([{ afterLine: 0, size: 1 }]);
        state.selections = [createCursorSelection(1, 0)];
        state.cursorPageUp(); // target row 1 is a zone → back up to row 0
        expect(active(state)).toEqual({ line: 0, character: 0 });
    });

    it("PageDown садится мимо зоны на ближайший документный ряд", () => {
        const state = makeState("aaaa bbbb cccc\nshort");
        state.viewportHeight = 3; // page = 2 rows
        state.setViewZones([{ afterLine: 0, size: 1 }]);
        state.selections = [createCursorSelection(0, 2)];
        state.cursorPageDown(); // row 0 + 2 = zone → back to the last document row above
        expect(active(state)).toEqual({ line: 0, character: 12 });
    });
});

describe("word wrap navigation — reveal", () => {
    it("reveal показывает РЯД каретки: хвост длинной строки скроллит вьюпорт", () => {
        // 8 fragments of 10 columns; viewport of 3 rows.
        const state = makeState(`${"aaaa bbbb ".repeat(8)}end`, 10);
        state.viewportHeight = 3;
        state.goToPosition(0, 82);
        expect(state.scrollTop).toBeGreaterThan(0);
        expect(state.scrollLeft).toBe(0);
    });
});
