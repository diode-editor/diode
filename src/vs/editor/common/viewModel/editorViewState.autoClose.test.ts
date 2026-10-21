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
    it("inserts the pair and keeps the cursor between them", () => {
        const state = makeState("ab", [createCursorSelection(0, 1)]);
        const element = state.typeWithAutoClose("{", "}");

        expect(state.document.getText()).toBe("a{}b");
        expect(spans(state)).toEqual([[0, 2, 0, 2]]);
        expect(element?.label).toBe("type");
    });

    it("multi-cursor: a pair at each cursor, every cursor inside its pair", () => {
        const state = makeState("a\nb", [createCursorSelection(0, 1), createCursorSelection(1, 1)]);
        state.typeWithAutoClose("(", ")");

        expect(state.document.getText()).toBe("a()\nb()");
        expect(spans(state)).toEqual([
            [0, 2, 0, 2],
            [1, 2, 1, 2],
        ]);
    });

    it("multi-character close (`/**` -> ` */`)", () => {
        const state = makeState("", [createCursorSelection(0, 0)]);
        // The typed character is `*` after an existing `/*`; only it and the close are inserted.
        state.document.setText("/*");
        state.selections = [createCursorSelection(0, 2)];
        state.typeWithAutoClose("*", " */");
        expect(state.document.getText()).toBe("/** */");
        expect(spans(state)).toEqual([[0, 3, 0, 3]]);
    });

    it("undo removes the whole pair, redo restores it", () => {
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

    it("cursor outside the viewport is revealed after inserting the pair", () => {
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
    it("types over the character under the cursor without editing the document", () => {
        const state = makeState("()", [createCursorSelection(0, 1)]);
        const versionBefore = state.document.versionId;
        state.typeOverClosingChar();

        expect(state.document.getText()).toBe("()");
        expect(state.document.versionId).toBe(versionBefore);
        expect(spans(state)).toEqual([[0, 2, 0, 2]]);
    });

    it("cursor outside the viewport is revealed after typing over", () => {
        const lines = Array.from({ length: 200 }, (_, i) => (i === 150 ? "()" : `line ${String(i)}`));
        const state = makeState(lines.join("\n"));
        state.viewportHeight = 10;
        state.selections = [createCursorSelection(150, 1)];
        state.scrollTop = 0;

        state.typeOverClosingChar();
        expect(state.scrollTop).toBeGreaterThan(0);
    });

    it("multi-cursor types over at each cursor", () => {
        const state = makeState("()\n()", [createCursorSelection(0, 1), createCursorSelection(1, 1)]);
        state.typeOverClosingChar();
        expect(spans(state)).toEqual([
            [0, 2, 0, 2],
            [1, 2, 1, 2],
        ]);
    });
});

describe("EditorViewState.surroundSelections", () => {
    it("surrounds the selection and keeps it on its text", () => {
        const state = makeState("const a = 1;", [createSelection(0, 6, 0, 7)]);
        const element = state.surroundSelections("(", ")");

        expect(state.document.getText()).toBe("const (a) = 1;");
        expect(spans(state)).toEqual([[0, 7, 0, 8]]);
        expect(element?.label).toBe("surround");
    });

    it("selection direction (anchor right of active) is kept", () => {
        const state = makeState("const a = 1;", [createSelection(0, 7, 0, 6)]);
        state.surroundSelections("'", "'");

        expect(state.document.getText()).toBe("const 'a' = 1;");
        expect(spans(state)).toEqual([[0, 8, 0, 7]]);
    });

    it("several selections on one line shift by their neighbors' inserts", () => {
        const state = makeState("aa bb", [createSelection(0, 0, 0, 2), createSelection(0, 3, 0, 5)]);
        state.surroundSelections("[", "]");

        expect(state.document.getText()).toBe("[aa] [bb]");
        expect(spans(state)).toEqual([
            [0, 1, 0, 3],
            [0, 6, 0, 8],
        ]);
    });

    it("multiline selection: opening at the start, closing at the end", () => {
        const state = makeState("aaa\nbbb", [createSelection(0, 1, 1, 2)]);
        state.surroundSelections("{", "}");

        expect(state.document.getText()).toBe("a{aa\nbb}b");
        expect(spans(state)).toEqual([[0, 2, 1, 2]]);
    });

    it("undo restores text and selection", () => {
        const state = makeState("aa bb", [createSelection(0, 0, 0, 2)]);
        const manager = new UndoManager(state.document);
        const element = state.surroundSelections("(", ")");
        if (element) manager.pushUndoElement(element);

        manager.undo(state);
        expect(state.document.getText()).toBe("aa bb");
        expect(spans(state)).toEqual([[0, 0, 0, 2]]);
    });

    it("cursor outside the viewport is revealed after surrounding", () => {
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
