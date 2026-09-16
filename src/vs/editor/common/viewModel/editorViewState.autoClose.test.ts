import { describe, expect, it } from "vitest";

import { createCursorSelection, createSelection } from "../core/iSelection.ts";
import { TextDocument } from "../model/textDocument.ts";
import { UndoManager } from "../model/undoManager.ts";

import { EditorViewState } from "./editorViewState.ts";

function makeState(text: string, selections = [createCursorSelection(0, 0)]): EditorViewState {
    const state = new EditorViewState(new TextDocument(text), selections);
    state.viewportWidth = 80;
    state.viewportHeight = 20;
    return state;
}

function spans(state: EditorViewState): number[][] {
    return state.selections.map((sel) => [
        sel.anchor.line,
        sel.anchor.character,
        sel.active.line,
        sel.active.character,
    ]);
}

describe("EditorViewState.typeWithAutoClose", () => {
    it("вставляет пару и оставляет каретку между токенами", () => {
        const state = makeState("ab", [createCursorSelection(0, 1)]);
        const element = state.typeWithAutoClose("{", "}");

        expect(state.document.getText()).toBe("a{}b");
        expect(spans(state)).toEqual([[0, 2, 0, 2]]);
        expect(element?.label).toBe("type");
    });

    it("мультикурсор: пара у каждой каретки, все каретки внутри своих пар", () => {
        const state = makeState("a\nb", [createCursorSelection(0, 1), createCursorSelection(1, 1)]);
        state.typeWithAutoClose("(", ")");

        expect(state.document.getText()).toBe("a()\nb()");
        expect(spans(state)).toEqual([
            [0, 2, 0, 2],
            [1, 2, 1, 2],
        ]);
    });

    it("многосимвольный close (`/**` → ` */`)", () => {
        const state = makeState("", [createCursorSelection(0, 0)]);
        // Набранный символ — `*` после уже стоящего `/*`; вставляется только он и close.
        state.document.setText("/*");
        state.selections = [createCursorSelection(0, 2)];
        state.typeWithAutoClose("*", " */");
        expect(state.document.getText()).toBe("/** */");
        expect(spans(state)).toEqual([[0, 3, 0, 3]]);
    });

    it("undo снимает пару целиком, redo возвращает", () => {
        const state = makeState("ab", [createCursorSelection(0, 1)]);
        const manager = new UndoManager(state.document);
        const element = state.typeWithAutoClose("{", "}");
        if (element) manager.pushUndoElement(element);

        manager.undo(state);
        expect(state.document.getText()).toBe("ab");
        expect(spans(state)).toEqual([[0, 1, 0, 1]]);

        manager.redo(state);
        expect(state.document.getText()).toBe("a{}b");
        expect(spans(state)).toEqual([[0, 2, 0, 2]]);
    });

    it("каретка за пределами вьюпорта прокручивается к себе после вставки пары", () => {
        const state = makeState(Array.from({ length: 200 }, (_, i) => `line ${String(i)}`).join("\n"));
        state.viewportHeight = 10;
        state.selections = [createCursorSelection(150, 0)];
        state.scrollTop = 0;

        state.typeWithAutoClose("{", "}");
        expect(state.scrollTop).toBeGreaterThan(0);
    });

    it("read-only — no-op", () => {
        const state = makeState("ab");
        state.readOnly = true;
        expect(state.typeWithAutoClose("{", "}")).toBeUndefined();
        expect(state.document.getText()).toBe("ab");
    });
});

describe("EditorViewState.typeOverClosingChar", () => {
    it("перешагивает символ под кареткой без правки документа", () => {
        const state = makeState("()", [createCursorSelection(0, 1)]);
        const versionBefore = state.document.versionId;
        state.typeOverClosingChar();

        expect(state.document.getText()).toBe("()");
        expect(state.document.versionId).toBe(versionBefore);
        expect(spans(state)).toEqual([[0, 2, 0, 2]]);
    });

    it("каретка за пределами вьюпорта прокручивается к себе после перешагивания", () => {
        const lines = Array.from({ length: 200 }, (_, i) => (i === 150 ? "()" : `line ${String(i)}`));
        const state = makeState(lines.join("\n"));
        state.viewportHeight = 10;
        state.selections = [createCursorSelection(150, 1)];
        state.scrollTop = 0;

        state.typeOverClosingChar();
        expect(state.scrollTop).toBeGreaterThan(0);
    });

    it("мультикурсор перешагивает у каждой каретки", () => {
        const state = makeState("()\n()", [createCursorSelection(0, 1), createCursorSelection(1, 1)]);
        state.typeOverClosingChar();
        expect(spans(state)).toEqual([
            [0, 2, 0, 2],
            [1, 2, 1, 2],
        ]);
    });
});

describe("EditorViewState.surroundSelections", () => {
    it("оборачивает выделение и оставляет его на своём тексте", () => {
        const state = makeState("const a = 1;", [createSelection(0, 6, 0, 7)]);
        const element = state.surroundSelections("(", ")");

        expect(state.document.getText()).toBe("const (a) = 1;");
        expect(spans(state)).toEqual([[0, 7, 0, 8]]);
        expect(element?.label).toBe("surround");
    });

    it("направление выделения (anchor правее active) сохраняется", () => {
        const state = makeState("const a = 1;", [createSelection(0, 7, 0, 6)]);
        state.surroundSelections("'", "'");

        expect(state.document.getText()).toBe("const 'a' = 1;");
        expect(spans(state)).toEqual([[0, 8, 0, 7]]);
    });

    it("несколько выделений на одной строке дрейфуют на вставки соседей", () => {
        const state = makeState("aa bb", [createSelection(0, 0, 0, 2), createSelection(0, 3, 0, 5)]);
        state.surroundSelections("[", "]");

        expect(state.document.getText()).toBe("[aa] [bb]");
        expect(spans(state)).toEqual([
            [0, 1, 0, 3],
            [0, 6, 0, 8],
        ]);
    });

    it("многострочное выделение: открывающая в начале, закрывающая в конце", () => {
        const state = makeState("aaa\nbbb", [createSelection(0, 1, 1, 2)]);
        state.surroundSelections("{", "}");

        expect(state.document.getText()).toBe("a{aa\nbb}b");
        expect(spans(state)).toEqual([[0, 2, 1, 2]]);
    });

    it("undo восстанавливает текст и выделение", () => {
        const state = makeState("aa bb", [createSelection(0, 0, 0, 2)]);
        const manager = new UndoManager(state.document);
        const element = state.surroundSelections("(", ")");
        if (element) manager.pushUndoElement(element);

        manager.undo(state);
        expect(state.document.getText()).toBe("aa bb");
        expect(spans(state)).toEqual([[0, 0, 0, 2]]);
    });

    it("каретка за пределами вьюпорта прокручивается к себе после обрамления", () => {
        const state = makeState(Array.from({ length: 200 }, (_, i) => `line ${String(i)}`).join("\n"));
        state.viewportHeight = 10;
        state.selections = [createSelection(150, 0, 150, 4)];
        state.scrollTop = 0;

        state.surroundSelections("(", ")");
        expect(state.scrollTop).toBeGreaterThan(0);
    });

    it("read-only — no-op", () => {
        const state = makeState("aa", [createSelection(0, 0, 0, 2)]);
        state.readOnly = true;
        expect(state.surroundSelections("(", ")")).toBeUndefined();
        expect(state.document.getText()).toBe("aa");
    });
});
