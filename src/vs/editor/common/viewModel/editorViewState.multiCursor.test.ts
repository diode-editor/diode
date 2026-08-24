import { describe, expect, it } from "vitest";

import { createFoldingRegion } from "../../contrib/folding/iFoldingRegion.ts";
import { createCursorSelection, createSelection } from "../core/iSelection.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

/** Пары «строка, символ» активных концов — компактный ассерт на набор кареток. */
function actives(state: EditorViewState): number[][] {
    return state.selections.map((sel) => [sel.active.line, sel.active.character]);
}

function makeLines(count: number): string {
    return Array.from({ length: count }, (_, i) => `line ${i.toString()}`).join("\n");
}

describe("EditorViewState.insertCursorBelow / insertCursorAbove", () => {
    it("добавляет каретку строкой ниже", () => {
        const state = new EditorViewState(new TextDocument("aaa\nbbb\nccc"), [createCursorSelection(0, 1)]);
        state.insertCursorBelow();
        expect(actives(state)).toEqual([
            [0, 1],
            [1, 1],
        ]);
    });

    it("добавляет каретку строкой выше", () => {
        const state = new EditorViewState(new TextDocument("aaa\nbbb\nccc"), [createCursorSelection(2, 2)]);
        state.insertCursorAbove();
        expect(actives(state)).toEqual([
            [1, 2],
            [2, 2],
        ]);
    });

    it("три нажатия Below наращивают пачку, а не удваивают её", () => {
        const state = new EditorViewState(new TextDocument(makeLines(6)), [createCursorSelection(0, 0)]);
        state.insertCursorBelow();
        state.insertCursorBelow();
        state.insertCursorBelow();
        // Копии внутренних кареток совпадают с уже существующими и схлопываются слиянием.
        expect(actives(state)).toEqual([
            [0, 0],
            [1, 0],
            [2, 0],
            [3, 0],
        ]);
    });

    it("Above на пачке 3-4-5 достраивает её сверху до 2-3-4-5", () => {
        const state = new EditorViewState(new TextDocument(makeLines(8)), [
            createCursorSelection(3, 0),
            createCursorSelection(4, 0),
            createCursorSelection(5, 0),
        ]);
        state.insertCursorAbove();
        expect(actives(state).map((pair) => pair[0])).toEqual([2, 3, 4, 5]);
    });

    it("на последней строке Below ничего не делает и не файрит событие", () => {
        const state = new EditorViewState(new TextDocument("aaa\nbbb"), [createCursorSelection(1, 0)]);
        let fired = 0;
        state.onDidChangeCursorPosition(() => {
            fired++;
        });
        state.insertCursorBelow();
        expect(state.selections).toHaveLength(1);
        expect(fired).toBe(0);
    });

    it("на первой строке Above ничего не делает", () => {
        const state = new EditorViewState(new TextDocument("aaa\nbbb"), [createCursorSelection(0, 0)]);
        state.insertCursorAbove();
        expect(state.selections).toHaveLength(1);
    });

    it("idealColumn переживает короткую строку по пути вниз", () => {
        const state = new EditorViewState(new TextDocument("abcdefgh\nxy\nabcdefgh"), [createCursorSelection(0, 6)]);
        state.insertCursorBelow();
        state.insertCursorBelow();
        expect(actives(state)).toEqual([
            [0, 6],
            [1, 2], // строка короче — каретка прижата к её концу
            [2, 6], // но «запомненная» колонка вернула её на место
        ]);
    });

    it("идеальная колонка считается по дисплею, а не по смещению (табы)", () => {
        const doc = new TextDocument("\t\tx\n________x");
        const state = new EditorViewState(doc, [createCursorSelection(0, 2)]);
        state.tabSize = 4;
        state.insertCursorBelow();
        // Два таба — это 8 дисплейных колонок, значит на строке из подчёркиваний
        // каретка встаёт в смещение 8, а не 2.
        expect(actives(state)).toEqual([
            [0, 2],
            [1, 8],
        ]);
    });

    it("свёрнутый регион проскакивается целиком", () => {
        const doc = new TextDocument("header\nbody 1\nbody 2\nafter");
        const state = new EditorViewState(doc, [createCursorSelection(0, 0)]);
        state.foldedRegions = [createFoldingRegion(0, 2, true)];
        state.insertCursorBelow();
        expect(actives(state)).toEqual([
            [0, 0],
            [3, 0],
        ]);
        // Ни одна каретка не осталась на скрытой строке.
        for (const sel of state.selections) {
            expect(state.logicalToVisualLine(sel.active.line)).toBeGreaterThanOrEqual(0);
        }
    });

    it("строка-зона не съедает шаг: каретка приезжает на документную строку", () => {
        const state = new EditorViewState(new TextDocument("aaa\nbbb\nccc"), [createCursorSelection(0, 0)]);
        state.setViewZones([{ afterLine: 0, size: 1 }]);
        state.insertCursorBelow();
        expect(actives(state)).toEqual([
            [0, 0],
            [1, 0],
        ]);
    });

    it("непустое выделение переезжает целиком, а не вырождается в каретку", () => {
        const state = new EditorViewState(new TextDocument("abcdef\nabcdef"), [createSelection(0, 1, 0, 4)]);
        state.insertCursorBelow();
        expect(state.selections).toHaveLength(2);
        expect(state.selections[1].anchor).toEqual({ line: 1, character: 1 });
        expect(state.selections[1].active).toEqual({ line: 1, character: 4 });
    });

    it("выделение переезжает и вверх, оба конца на строку выше", () => {
        const state = new EditorViewState(new TextDocument("abcdef\nabcdef\nabcdef"), [createSelection(2, 1, 2, 4)]);
        state.insertCursorAbove();
        expect(state.selections).toHaveLength(2);
        expect(state.selections[0].anchor).toEqual({ line: 1, character: 1 });
        expect(state.selections[0].active).toEqual({ line: 1, character: 4 });
    });

    it("выделение со второй строки переезжает на нулевую", () => {
        // Якорь встаёт ровно на нулевую строку — граничный случай «двигать некуда»
        // проходит по строке ниже нуля, а не по самой нулевой.
        const state = new EditorViewState(new TextDocument("abcdef\nabcdef\nabcdef"), [createSelection(1, 1, 1, 4)]);

        state.insertCursorAbove();

        expect(state.selections).toHaveLength(2);
        expect(state.selections[0].anchor).toEqual({ line: 0, character: 1 });
        expect(state.selections[0].active).toEqual({ line: 0, character: 4 });
    });

    it("обратное выделение у края документа копии не даёт и события не шлёт", () => {
        // Якорь на последней строке двигаться не может, а active может: копия целиком
        // легла бы внутрь исходного выделения, и слияние съело бы её без следа.
        const state = new EditorViewState(new TextDocument("aaa\nbbb\nccc"), [createSelection(2, 0, 1, 0)]);
        let fired = 0;
        state.onDidChangeCursorPosition(() => {
            fired++;
        });
        state.insertCursorBelow();
        expect(state.selections).toHaveLength(1);
        expect(fired).toBe(0);
    });

    it("вьюпорт едет за новой кареткой вверх", () => {
        const state = new EditorViewState(new TextDocument(makeLines(40)), [createCursorSelection(30, 0)]);
        state.viewportHeight = 10;
        state.viewportWidth = 40;
        state.scrollTop = 30; // каретка в первой видимой строке

        state.insertCursorAbove();

        // Показывать надо ВЕРХНЮЮ каретку — она и есть новая. Показывай нижнюю,
        // вьюпорт не двинулся бы: она и так на экране.
        expect(state.scrollTop).toBe(29);
    });

    it("вьюпорт едет за новой кареткой вниз", () => {
        const state = new EditorViewState(new TextDocument(makeLines(40)), [createCursorSelection(9, 0)]);
        state.viewportHeight = 10;
        state.viewportWidth = 40;
        expect(state.scrollTop).toBe(0);
        state.insertCursorBelow();
        expect(state.scrollTop).toBe(1);
    });
});

describe("EditorViewState.removeSecondaryCursors", () => {
    it("оставляет первичную каретку", () => {
        const state = new EditorViewState(new TextDocument("aaa\nbbb\nccc"), [
            createCursorSelection(0, 1),
            createCursorSelection(2, 2),
        ]);
        state.removeSecondaryCursors();
        expect(actives(state)).toEqual([[0, 1]]);
    });

    it("при одной каретке — no-op без события", () => {
        const state = new EditorViewState(new TextDocument("aaa"), [createCursorSelection(0, 1)]);
        let fired = 0;
        state.onDidChangeCursorPosition(() => {
            fired++;
        });
        state.removeSecondaryCursors();
        expect(fired).toBe(0);
    });

    it("подтягивает вьюпорт к уцелевшей каретке", () => {
        const state = new EditorViewState(new TextDocument(makeLines(60)), [
            createCursorSelection(0, 0),
            createCursorSelection(50, 0),
        ]);
        state.viewportHeight = 10;
        state.viewportWidth = 40;
        state.scrollTop = 45;
        state.removeSecondaryCursors();
        expect(state.scrollTop).toBe(0);
    });
});

describe("EditorViewState.toggleCursorAt", () => {
    it("добавляет каретку в свободной точке", () => {
        const state = new EditorViewState(new TextDocument("aaa\nbbb"), [createCursorSelection(0, 0)]);
        state.toggleCursorAt(1, 2);
        expect(actives(state)).toEqual([
            [0, 0],
            [1, 2],
        ]);
    });

    it("снимает каретку точным попаданием", () => {
        const state = new EditorViewState(new TextDocument("aaa\nbbb"), [
            createCursorSelection(0, 0),
            createCursorSelection(1, 2),
        ]);
        state.toggleCursorAt(1, 2);
        expect(actives(state)).toEqual([[0, 0]]);
    });

    it("клик внутрь выделения снимает его целиком", () => {
        const state = new EditorViewState(new TextDocument("abcdef\nbbb"), [
            createSelection(0, 1, 0, 5),
            createCursorSelection(1, 0),
        ]);
        state.toggleCursorAt(0, 3);
        expect(actives(state)).toEqual([[1, 0]]);
    });

    it("последнюю каретку не снимает", () => {
        const state = new EditorViewState(new TextDocument("aaa"), [createCursorSelection(0, 1)]);
        let fired = 0;
        state.onDidChangeCursorPosition(() => {
            fired++;
        });
        state.toggleCursorAt(0, 1);
        expect(actives(state)).toEqual([[0, 1]]);
        expect(fired).toBe(0);
    });

    it("вьюпорт едет к добавленной каретке", () => {
        const state = new EditorViewState(new TextDocument(makeLines(60)), [createCursorSelection(0, 0)]);
        state.viewportHeight = 10;
        state.viewportWidth = 40;
        state.toggleCursorAt(30, 0);
        expect(state.scrollTop).toBeGreaterThan(0);
    });
});

describe("EditorViewState.revealSelection", () => {
    it("разворачивает свёртку, прячущую цель", () => {
        const doc = new TextDocument("header\nbody 1\nbody 2\nafter");
        const state = new EditorViewState(doc, [createCursorSelection(0, 0)]);
        state.viewportHeight = 10;
        state.viewportWidth = 40;
        state.foldedRegions = [createFoldingRegion(0, 2, true)];
        state.revealSelection(createCursorSelection(2, 0));
        expect(state.foldedRegions[0].isCollapsed).toBe(false);
    });

    it("разворачивает свёртки и над началом, и над концом выделения", () => {
        const state = new EditorViewState(new TextDocument(makeLines(8)), [createCursorSelection(0, 0)]);
        state.viewportHeight = 10;
        state.viewportWidth = 40;
        state.foldedRegions = [createFoldingRegion(0, 2, true), createFoldingRegion(4, 6, true)];

        state.revealSelection(createSelection(1, 0, 5, 0));

        // Спрятать выделение может любой из его концов, поэтому разворачивать надо
        // оба: проверка на каретке этого не видит — там начало и конец совпадают.
        expect(state.foldedRegions.map((region) => region.isCollapsed)).toEqual([false, false]);
    });

    it("скроллит именно к переданному выделению, а не к первичному", () => {
        const state = new EditorViewState(new TextDocument(makeLines(60)), [createCursorSelection(0, 0)]);
        state.viewportHeight = 10;
        state.viewportWidth = 40;
        state.revealSelection(createSelection(40, 0, 40, 3));
        expect(state.scrollTop).toBeGreaterThan(0);
    });
});

describe("EditorViewState.getSelectedTexts", () => {
    it("текст каждого выделения в документном порядке", () => {
        const doc = new TextDocument("alpha\nbeta");
        const state = new EditorViewState(doc, [createSelection(1, 0, 1, 4), createSelection(0, 0, 0, 5)]);
        expect(state.getSelectedTexts()).toEqual(["alpha", "beta"]);
    });

    it("схлопнутая каретка даёт пустую строку", () => {
        const doc = new TextDocument("alpha\nbeta");
        const state = new EditorViewState(doc, [createSelection(0, 0, 0, 5), createCursorSelection(1, 2)]);
        expect(state.getSelectedTexts()).toEqual(["alpha", ""]);
    });
});
