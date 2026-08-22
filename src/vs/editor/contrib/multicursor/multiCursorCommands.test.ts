import { describe, expect, it } from "vitest";

import { createCursorSelection, createSelection, selectionToRange } from "../../common/core/iSelection.ts";
import { TextDocument } from "../../common/model/textDocument.ts";
import { EditorViewState } from "../../common/viewModel/editorViewState.ts";

import {
    addSelectionToNextFindMatch,
    addSelectionToPreviousFindMatch,
    insertCursorAtEndOfEachLineSelected,
    moveSelectionToNextFindMatch,
    moveSelectionToPreviousFindMatch,
    selectHighlights,
} from "./multiCursorCommands.ts";

/** Тексты выделений в документном порядке — самый читаемый ассерт для этих команд. */
function texts(state: EditorViewState): string[] {
    return state.selections.map((sel) => state.document.getTextInRange(selectionToRange(sel)));
}

/** Диапазоны выделений как [строка, начало, конец]; все они однострочные. */
function spans(state: EditorViewState): number[][] {
    return state.selections.map((sel) => {
        const range = selectionToRange(sel);
        return [range.start.line, range.start.character, range.end.character];
    });
}

function makeState(text: string, line = 0, character = 0): EditorViewState {
    const state = new EditorViewState(new TextDocument(text), [createCursorSelection(line, character)]);
    state.viewportWidth = 80;
    state.viewportHeight = 20;
    return state;
}

describe("addSelectionToNextFindMatch (Ctrl+D)", () => {
    it("первое нажатие выделяет слово под кареткой, второе добавляет следующее вхождение", () => {
        const state = makeState("foo bar\nfoo baz", 0, 1);

        addSelectionToNextFindMatch(state);
        expect(spans(state)).toEqual([[0, 0, 3]]);

        addSelectionToNextFindMatch(state);
        expect(spans(state)).toEqual([
            [0, 0, 3],
            [1, 0, 3],
        ]);
        expect(texts(state)).toEqual(["foo", "foo"]);
    });

    it("после последнего вхождения заворачивается и дальше становится no-op", () => {
        const state = makeState("foo\nfoo\nfoo", 0, 0);
        addSelectionToNextFindMatch(state); // выделило слово
        addSelectionToNextFindMatch(state);
        addSelectionToNextFindMatch(state);
        expect(state.selections).toHaveLength(3);

        let fired = 0;
        state.onDidChangeCursorPosition(() => {
            fired++;
        });
        addSelectionToNextFindMatch(state);
        expect(state.selections).toHaveLength(3);
        expect(fired).toBe(0);
    });

    it("от непустого выделения сразу добавляет второе вхождение", () => {
        const state = makeState("foobar foobar");
        state.selections = [createSelection(0, 0, 0, 4)]; // "foob"

        addSelectionToNextFindMatch(state);
        expect(spans(state)).toEqual([
            [0, 0, 4],
            [0, 7, 11],
        ]);
    });

    it("ищет по целым словам, когда стартовал от каретки", () => {
        const state = makeState("text context text", 0, 1);
        addSelectionToNextFindMatch(state);
        addSelectionToNextFindMatch(state);
        // `text` внутри `context` пропущено.
        expect(spans(state)).toEqual([
            [0, 0, 4],
            [0, 13, 17],
        ]);
    });

    it("слово-одиночка: второе нажатие ничего не добавляет", () => {
        const state = makeState("alpha beta", 0, 0);
        addSelectionToNextFindMatch(state);
        addSelectionToNextFindMatch(state);
        expect(state.selections).toHaveLength(1);
    });

    it("каретка не на слове — команда молчит", () => {
        const state = makeState("a + b", 0, 2);
        addSelectionToNextFindMatch(state);
        expect(state.selections).toHaveLength(1);
        expect(state.selections[0].active).toEqual({ line: 0, character: 2 });
    });

    it("вьюпорт едет к добавленному вхождению, а не остаётся у первичного", () => {
        const filler = Array.from({ length: 60 }, () => "filler").join("\n");
        const state = makeState(`foo\n${filler}\nfoo`, 0, 0);
        state.viewportHeight = 10;

        addSelectionToNextFindMatch(state);
        addSelectionToNextFindMatch(state);

        expect(state.selections).toHaveLength(2);
        expect(state.scrollTop).toBeGreaterThan(0);
    });

    it("заворот вверх поднимает вьюпорт к найденному вхождению", () => {
        const filler = Array.from({ length: 60 }, () => "filler").join("\n");
        const state = makeState(`foo\n${filler}\nfoo`, 61, 0);
        state.viewportHeight = 10;
        state.scrollTop = 52;

        addSelectionToNextFindMatch(state); // выделило нижнее слово
        addSelectionToNextFindMatch(state); // заворот на верхнее

        expect(state.scrollTop).toBe(0);
    });
});

describe("addSelectionToNextFindMatch — инвалидация сессии", () => {
    it("движение каретки между шагами перезапускает поиск от нового места", () => {
        const state = makeState("foo bar\nfoo bar", 0, 0);
        addSelectionToNextFindMatch(state);
        addSelectionToNextFindMatch(state);
        expect(texts(state)).toEqual(["foo", "foo"]);

        // Пользователь ушёл кареткой — сессия протухла.
        state.selections = [createCursorSelection(0, 5)];
        addSelectionToNextFindMatch(state);
        expect(texts(state)).toEqual(["bar"]);
    });

    it("правка документа перезапускает поиск", () => {
        const state = makeState("foo bar\nfoo bar", 0, 0);
        addSelectionToNextFindMatch(state);
        addSelectionToNextFindMatch(state);

        state.selections = [createCursorSelection(1, 4)];
        state.type("X");
        addSelectionToNextFindMatch(state);
        // Слово под кареткой после правки — `Xbar`, и оно одно.
        expect(texts(state)).toEqual(["Xbar"]);
    });

    it("несколько кареток с разным текстом: шаг уходит на расширение до слов", () => {
        const state = makeState("alpha beta", 0, 0);
        state.selections = [createCursorSelection(0, 1), createCursorSelection(0, 7)];

        addSelectionToNextFindMatch(state);

        expect(texts(state)).toEqual(["alpha", "beta"]);
    });

    it("расширяет только схлопнутые, непустые выделения не трогает", () => {
        const state = makeState("alpha beta");
        state.selections = [createSelection(0, 0, 0, 2), createCursorSelection(0, 7)];

        addSelectionToNextFindMatch(state);

        expect(texts(state)).toEqual(["al", "beta"]);
    });

    it("каретка на пунктуации среди прочих остаётся кареткой", () => {
        const state = makeState("alpha + beta");
        state.selections = [createCursorSelection(0, 1), createCursorSelection(0, 6)];

        addSelectionToNextFindMatch(state);

        expect(texts(state)).toEqual(["alpha", ""]);
    });

    it("расширять нечего — набор не трогаем и события не шлём", () => {
        const state = makeState("a + b");
        state.selections = [createCursorSelection(0, 2), createSelection(0, 3, 0, 4)];
        let fired = 0;
        state.onDidChangeCursorPosition(() => {
            fired++;
        });

        addSelectionToNextFindMatch(state);

        expect(fired).toBe(0);
    });

    it("несколько выделений с ОДИНАКОВЫМ текстом продолжают поиск сразу", () => {
        const state = makeState("foo foo foo");
        state.selections = [createSelection(0, 0, 0, 3), createSelection(0, 4, 0, 7)];

        addSelectionToNextFindMatch(state);

        expect(spans(state)).toEqual([
            [0, 0, 3],
            [0, 4, 7],
            [0, 8, 11],
        ]);
    });
});

describe("addSelectionToPreviousFindMatch", () => {
    it("добавляет вхождение выше по документу", () => {
        const state = makeState("foo\nbar\nfoo", 2, 1);
        addSelectionToPreviousFindMatch(state); // выделило слово
        addSelectionToPreviousFindMatch(state);
        expect(spans(state)).toEqual([
            [0, 0, 3],
            [2, 0, 3],
        ]);
    });
});

describe("moveSelectionToNextFindMatch (Ctrl+K Ctrl+D)", () => {
    it("переносит последнее добавленное выделение, не растя их число", () => {
        const state = makeState("foo\nfoo\nfoo", 0, 0);
        addSelectionToNextFindMatch(state);
        addSelectionToNextFindMatch(state);
        expect(spans(state)).toEqual([
            [0, 0, 3],
            [1, 0, 3],
        ]);

        moveSelectionToNextFindMatch(state);
        expect(spans(state)).toEqual([
            [0, 0, 3],
            [2, 0, 3],
        ]);
    });

    it("переносит и назад", () => {
        const state = makeState("foo\nfoo\nfoo", 0, 0);
        addSelectionToNextFindMatch(state);
        addSelectionToNextFindMatch(state);

        moveSelectionToPreviousFindMatch(state);
        expect(spans(state)).toEqual([
            [0, 0, 3],
            [2, 0, 3],
        ]);
    });

    it("на единственном вхождении не залипает: прежнее место снова свободно", () => {
        const state = makeState("foo bar", 0, 0);
        addSelectionToNextFindMatch(state);
        moveSelectionToNextFindMatch(state);
        expect(spans(state)).toEqual([[0, 0, 3]]);
    });
});

describe("selectHighlights (Ctrl+Shift+L)", () => {
    it("выделяет все вхождения слова под кареткой сразу", () => {
        const state = makeState("foo bar\nfoo baz\nfoo", 0, 1);
        selectHighlights(state);
        expect(spans(state)).toEqual([
            [0, 0, 3],
            [1, 0, 3],
            [2, 0, 3],
        ]);
    });

    it("повторный вызов ничего не меняет", () => {
        const state = makeState("foo\nfoo", 0, 0);
        selectHighlights(state);
        selectHighlights(state);
        expect(state.selections).toHaveLength(2);
    });

    it("после него Ctrl+D — стабильный no-op: всё уже выделено", () => {
        const state = makeState("foo\nfoo", 0, 0);
        selectHighlights(state);
        addSelectionToNextFindMatch(state);
        expect(state.selections).toHaveLength(2);
    });

    it("подхватывает живую сессию Ctrl+D вместо перезапуска от каретки", () => {
        const state = makeState("foobar foobar foobar");
        state.selections = [createSelection(0, 0, 0, 4)]; // подстрока "foob"
        addSelectionToNextFindMatch(state);

        selectHighlights(state);
        expect(state.selections).toHaveLength(3);
        expect(texts(state)).toEqual(["foob", "foob", "foob"]);
    });

    it("вьюпорт остаётся у прежней каретки, а не прыгает в начало файла", () => {
        const filler = Array.from({ length: 60 }, () => "filler").join("\n");
        const state = makeState(`foo\n${filler}\nfoo`, 61, 1);
        state.viewportHeight = 10;
        state.scrollTop = 52;

        selectHighlights(state);

        expect(state.selections).toHaveLength(2);
        expect(state.scrollTop).toBeGreaterThan(0);
    });

    it("каретка не на слове — no-op", () => {
        const state = makeState("a + b", 0, 2);
        selectHighlights(state);
        expect(state.selections).toHaveLength(1);
    });


});

describe("insertCursorAtEndOfEachLineSelected (Ctrl+Shift+Alt+I)", () => {
    it("каретка в конец каждой затронутой строки", () => {
        const state = makeState("alpha\nbe\ngamma");
        state.selections = [createSelection(0, 1, 2, 3)];

        insertCursorAtEndOfEachLineSelected(state);

        expect(state.selections.map((sel) => [sel.active.line, sel.active.character])).toEqual([
            [0, 5],
            [1, 2],
            [2, 3],
        ]);
    });

    it("выделение, кончающееся в колонке 0, последней строке каретки не даёт", () => {
        const state = makeState("alpha\nbeta\ngamma");
        state.selections = [createSelection(0, 0, 2, 0)];

        insertCursorAtEndOfEachLineSelected(state);

        expect(state.selections.map((sel) => sel.active.line)).toEqual([0, 1]);
    });

    it("все выделения схлопнуты — no-op без события", () => {
        const state = makeState("alpha\nbeta", 0, 2);
        let fired = 0;
        state.onDidChangeCursorPosition(() => {
            fired++;
        });
        insertCursorAtEndOfEachLineSelected(state);
        expect(state.selections).toHaveLength(1);
        expect(fired).toBe(0);
    });

    it("сбрасывает сессию Ctrl+D — набор кареток к ней больше не относится", () => {
        const state = makeState("foo\nfoo", 0, 0);
        addSelectionToNextFindMatch(state);
        expect(state.multiCursorSession).not.toBeNull();

        state.selections = [createSelection(0, 0, 1, 3)];
        insertCursorAtEndOfEachLineSelected(state);
        expect(state.multiCursorSession).toBeNull();
    });
});

describe("мультикурсорный поиск в read-only", () => {
    it("работает: выделение ничего не меняет в документе", () => {
        const state = makeState("foo\nfoo", 0, 0);
        state.readOnly = true;
        addSelectionToNextFindMatch(state);
        addSelectionToNextFindMatch(state);
        expect(state.selections).toHaveLength(2);
    });
});
