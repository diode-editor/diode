import { describe, expect, it } from "vitest";

import { createRange } from "../core/iRange.ts";
import { createCursorSelection } from "../core/iSelection.ts";
import { createTextEdit } from "../core/iTextEdit.ts";
import { EditorViewState } from "../viewModel/editorViewState.ts";

import { TextDocument } from "./textDocument.ts";
import { UndoManager } from "./undoManager.ts";

// Герметичный двойник quick fix стокового typescript-language-server: два смежных
// удаления на одной строке (форма снята с живого сервера,
// extensionHost.typescriptLsp.codeActions.test.ts).

const IMPORT_LINE = 'import { test, assert } from "./test.js";';
const FIXED_LINE = 'import { test } from "./test.js";';

const QUICK_FIX_EDITS = [createTextEdit(createRange(0, 13, 0, 15), ""), createTextEdit(createRange(0, 15, 0, 21), "")];

function setup(text: string) {
    const doc = new TextDocument(text);
    const viewState = new EditorViewState(doc);
    const undoManager = new UndoManager(doc);
    return { doc, viewState, undoManager };
}

/** Тот же путь, что у applyExternalEdits. */
function applyExternal(
    viewState: EditorViewState,
    undoManager: UndoManager,
    edits: readonly ReturnType<typeof createTextEdit>[],
): void {
    const element = viewState.applyEdits(edits, "quick fix");
    expect(element).toBeDefined();
    undoManager.pushUndoElement(element!);
}

describe("UndoManager — внешний батч правок (quick fix)", () => {
    it("undo возвращает строку импорта дословно", () => {
        const { doc, viewState, undoManager } = setup(IMPORT_LINE);

        applyExternal(viewState, undoManager, QUICK_FIX_EDITS);
        expect(doc.getText()).toBe(FIXED_LINE);

        expect(undoManager.undo(viewState)).toBe(true);
        expect(doc.getText()).toBe(IMPORT_LINE);
    });

    it("redo повторяет фикс, следующий undo снова возвращает исходную строку", () => {
        const { doc, viewState, undoManager } = setup(IMPORT_LINE);

        applyExternal(viewState, undoManager, QUICK_FIX_EDITS);
        undoManager.undo(viewState);

        expect(undoManager.redo(viewState)).toBe(true);
        expect(doc.getText()).toBe(FIXED_LINE);

        expect(undoManager.undo(viewState)).toBe(true);
        expect(doc.getText()).toBe(IMPORT_LINE);
    });

    it("цепочка: набор текста после фикса откатывается по шагам до исходного", () => {
        const { doc, viewState, undoManager } = setup(IMPORT_LINE);

        applyExternal(viewState, undoManager, QUICK_FIX_EDITS);

        viewState.selections = [createCursorSelection(0, doc.getLineLength(0))];
        const typed = viewState.type("\ntest;");
        undoManager.pushUndoElement(typed!);
        expect(doc.getText()).toBe(`${FIXED_LINE}\ntest;`);

        expect(undoManager.undo(viewState)).toBe(true);
        expect(doc.getText()).toBe(FIXED_LINE);

        expect(undoManager.undo(viewState)).toBe(true);
        expect(doc.getText()).toBe(IMPORT_LINE);

        expect(undoManager.redo(viewState)).toBe(true);
        expect(doc.getText()).toBe(FIXED_LINE);

        expect(undoManager.redo(viewState)).toBe(true);
        expect(doc.getText()).toBe(`${FIXED_LINE}\ntest;`);
    });

    it("undo батча, склеившего строки, возвращает переводы строк на место", () => {
        // Обратная правка второй обязана уехать и по строке, И по колонке.
        const text = 'import {\n    test, assert,\n} from "./test.js";';
        const { doc, viewState, undoManager } = setup(text);

        applyExternal(viewState, undoManager, [
            createTextEdit(createRange(0, 8, 1, 4), ""),
            createTextEdit(createRange(1, 8, 1, 16), ""),
        ]);
        expect(doc.getText()).toBe('import {test,\n} from "./test.js";');

        expect(undoManager.undo(viewState)).toBe(true);
        expect(doc.getText()).toBe(text);
    });
});
