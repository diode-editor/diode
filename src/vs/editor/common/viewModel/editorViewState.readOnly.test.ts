import { describe, expect, it } from "vitest";

import { createRange } from "../core/iRange.ts";
import { createCursorSelection, createSelection } from "../core/iSelection.ts";
import { createTextEdit } from "../core/iTextEdit.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

function readOnlyState(text = "hello world", selection = createCursorSelection(0, 5)) {
    const doc = new TextDocument(text);
    const state = new EditorViewState(doc, [selection]);
    state.readOnly = true;
    return { doc, state };
}

describe("EditorViewState read-only: мутаторы", () => {
    // versionId is checked separately: if it grew, the buffer would become dirty.
    const mutators: readonly [name: string, run: (state: EditorViewState) => unknown][] = [
        ["type", (s) => s.type("X")],
        ["insertText", (s) => s.insertText("X")],
        ["insertNewLine", (s) => s.insertNewLine()],
        ["deleteLeft", (s) => s.deleteLeft()],
        ["deleteRight", (s) => s.deleteRight()],
        ["deleteWordLeft", (s) => s.deleteWordLeft()],
        ["deleteWordRight", (s) => s.deleteWordRight()],
        ["deleteAllLeft", (s) => s.deleteAllLeft()],
        ["outdentLines", (s) => s.outdentLines()],
    ];

    for (const [name, run] of mutators) {
        it(`${name} — no-op, документ и versionId не меняются`, () => {
            const { doc, state } = readOnlyState("    hello world");
            const versionBefore = doc.versionId;

            expect(run(state)).toBeUndefined();

            expect(doc.getText()).toBe("    hello world");
            expect(doc.versionId).toBe(versionBefore);
        });
    }

    it("applyEdits — no-op даже при непустом списке правок", () => {
        const { doc, state } = readOnlyState();
        const versionBefore = doc.versionId;
        const edits = [createTextEdit(createRange(0, 0, 0, 5), "goodbye")];

        expect(state.applyEdits(edits, "external")).toBeUndefined();

        expect(doc.getText()).toBe("hello world");
        expect(doc.versionId).toBe(versionBefore);
    });

    it("indentLines — no-op и на однострочном пути (через type), и на многострочном (через shiftIndent)", () => {
        // The single-line branch of indentLines delegates to type(), the multi-line one to shiftIndent();
        // they are guarded separately, so both are checked.
        const single = readOnlyState("hello\nworld", createCursorSelection(0, 2));
        expect(single.state.indentLines()).toBeUndefined();
        expect(single.doc.getText()).toBe("hello\nworld");

        const multi = readOnlyState("hello\nworld", createSelection(0, 0, 1, 3));
        expect(multi.state.indentLines()).toBeUndefined();
        expect(multi.doc.getText()).toBe("hello\nworld");
    });

    it("type с выделением не съедает выделенный текст", () => {
        // Separate case: the replace-selection path bypasses "insert at position",
        // and unguarded it would erase text even without inserting.
        const { doc, state } = readOnlyState("hello world", createSelection(0, 0, 0, 5));

        expect(state.type("X")).toBeUndefined();

        expect(doc.getText()).toBe("hello world");
    });
});

describe("EditorViewState read-only: view-состояние остаётся живым", () => {
    it("курсор двигается", () => {
        const { state } = readOnlyState();
        state.cursorRight();
        expect(state.selections[0].active).toEqual({ line: 0, character: 6 });
    });

    it("выделение строится и читается", () => {
        const { state } = readOnlyState();
        state.selections = [createSelection(0, 0, 0, 5)];
        expect(state.getSelectedText()).toBe("hello");
    });

    it("фолдинг сворачивает регион", () => {
        const doc = new TextDocument("function f() {\n    body\n}\n");
        const state = new EditorViewState(doc, [createCursorSelection(0, 0)]);
        state.readOnly = true;
        state.foldedRegions = [{ startLine: 0, endLine: 2, isCollapsed: false }];
        const expanded = state.getViewLineCount();

        state.toggleFold(0);

        expect(state.getViewLineCount()).toBeLessThan(expanded);
    });
});

describe("EditorViewState: writable по умолчанию", () => {
    it("свежий view-state правится (флаг не включён исподтишка)", () => {
        const doc = new TextDocument("hello");
        const state = new EditorViewState(doc, [createCursorSelection(0, 5)]);

        expect(state.readOnly).toBe(false);
        expect(state.type(" world")).toBeDefined();
        expect(doc.getText()).toBe("hello world");
    });

    it("снятие флага возвращает правку", () => {
        const { doc, state } = readOnlyState("hello", createCursorSelection(0, 5));
        expect(state.type("!")).toBeUndefined();

        state.readOnly = false;

        expect(state.type("!")).toBeDefined();
        expect(doc.getText()).toBe("hello!");
    });
});
