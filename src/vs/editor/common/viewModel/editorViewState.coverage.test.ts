import { describe, expect, it } from "vitest";

import { createFoldingRegion } from "../../contrib/folding/iFoldingRegion.ts";
import { createCursorSelection } from "../core/iSelection.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

describe("EditorViewState.runDetectIndentation — disabled", () => {
    it("falls back to the configured values when detectIndentation is false", () => {
        // Документ отступлён табами, но детекцию выключили — содержимое не в счёт.
        const doc = new TextDocument("\tindented\n\tindented");
        const state = new EditorViewState(doc);
        state.configuredInsertSpaces = true;
        state.configuredTabSize = 8;
        state.detectIndentation = false;

        state.runDetectIndentation();

        expect(state.insertSpaces).toBe(true);
        expect(state.tabSize).toBe(8);
    });
});

describe("EditorViewState.cursorLeft — end-of-line and grapheme slots", () => {
    it("moves to the previous grapheme offset when at end of a multi-char line", () => {
        const doc = new TextDocument("abc");
        const state = new EditorViewState(doc, [createCursorSelection(0, 3)]);
        state.cursorLeft();
        expect(state.selections[0].active).toEqual({ line: 0, character: 2 });
    });

    it("lands at column 0 when the cursor sits inside the first grapheme", () => {
        // Offset 1 — внутри эмодзи-слота 0.
        const doc = new TextDocument("😀b");
        const state = new EditorViewState(doc, [createCursorSelection(0, 1)]);
        state.cursorLeft();
        expect(state.selections[0].active).toEqual({ line: 0, character: 0 });
    });

    it("wraps to the end of the previous visible line from line start", () => {
        const doc = new TextDocument("abc\nde");
        const state = new EditorViewState(doc, [createCursorSelection(1, 0)]);
        state.cursorLeft();
        expect(state.selections[0].active).toEqual({ line: 0, character: 3 });
    });
});

describe("EditorViewState.deleteLeft — slot boundaries", () => {
    it("deletes the last grapheme when the cursor is at end of line", () => {
        const doc = new TextDocument("abc");
        const state = new EditorViewState(doc, [createCursorSelection(0, 3)]);
        state.deleteLeft();
        expect(doc.getText()).toBe("ab");
    });

    it("deletes back to column 0 when the cursor is inside the first grapheme", () => {
        // Offset 1 — внутри эмодзи-слота 0, поэтому удаляется [0, 1).
        const doc = new TextDocument("😀b");
        const before = doc.getText().length;
        const state = new EditorViewState(doc, [createCursorSelection(0, 1)]);
        state.deleteLeft();
        expect(doc.getText().length).toBe(before - 1);
        expect(state.selections[0].active).toEqual({ line: 0, character: 0 });
    });
});

describe("EditorViewState.deleteRight — slot resolves", () => {
    it("deletes the grapheme under the cursor mid-line", () => {
        const doc = new TextDocument("abc");
        const state = new EditorViewState(doc, [createCursorSelection(0, 1)]);
        state.deleteRight();
        expect(doc.getText()).toBe("ac");
    });
});

describe("EditorViewState page navigation — fresh cursor", () => {
    it("cursorPageDown computes ideal column from the offset when idealColumn is unset", () => {
        const doc = new TextDocument("0123\n0123\n0123\n0123\n0123");
        const state = new EditorViewState(doc, [createCursorSelection(0, 2)]);
        state.viewportHeight = 3;
        state.cursorPageDown();
        expect(state.selections[0].active.character).toBe(2);
        expect(state.selections[0].active.line).toBeGreaterThan(0);
    });

    it("cursorPageDown reuses the stored idealColumn on a second invocation", () => {
        // Второй вызов идёт уже с явным idealColumn от первого.
        const doc = new TextDocument("0123\n0123\n0123\n0123\n0123\n0123\n0123");
        const state = new EditorViewState(doc, [createCursorSelection(0, 3)]);
        state.viewportHeight = 3;
        state.cursorPageDown();
        expect(state.selections[0].idealColumn).toBe(3);
        state.cursorPageDown();
        expect(state.selections[0].active.character).toBe(3);
    });

    it("cursorPageUp computes ideal column from the offset when idealColumn is unset", () => {
        const doc = new TextDocument("0123\n0123\n0123\n0123\n0123");
        const state = new EditorViewState(doc, [createCursorSelection(4, 3)]);
        state.viewportHeight = 3;
        state.cursorPageUp();
        expect(state.selections[0].active.character).toBe(3);
        expect(state.selections[0].active.line).toBeLessThan(4);
    });

    it("cursorPageUp reuses the stored idealColumn on a second invocation", () => {
        const doc = new TextDocument("0123\n0123\n0123\n0123\n0123\n0123\n0123");
        const state = new EditorViewState(doc, [createCursorSelection(6, 2)]);
        state.viewportHeight = 3;
        state.cursorPageUp();
        expect(state.selections[0].idealColumn).toBe(2);
        state.cursorPageUp();
        expect(state.selections[0].active.character).toBe(2);
    });
});

describe("EditorViewState.ensureCursorVisible — guard branches", () => {
    it("does nothing when the viewport has zero size", () => {
        const doc = new TextDocument("a\nb\nc\nd\ne\nf");
        const state = new EditorViewState(doc, [createCursorSelection(5, 0)]);
        state.viewportWidth = 0;
        state.viewportHeight = 0;
        state.scrollTop = 0;
        state.type("X");
        expect(state.scrollTop).toBe(0);
    });

    it("does nothing when there are no selections", () => {
        const doc = new TextDocument("a\nb\nc");
        const state = new EditorViewState(doc);
        state.scrollTop = 0;
        state.restoreSelections([]);
        expect(state.scrollTop).toBe(0);
        expect(state.selections).toHaveLength(0);
    });

    it("reveals the fold when restoreSelections lands the cursor on a hidden line", () => {
        const doc = new TextDocument("h\nx\ny\nz\nt");
        const state = new EditorViewState(doc, [createCursorSelection(0, 0)]);
        state.setFoldingRegions([createFoldingRegion(0, 3, true)]);
        expect(state.logicalToVisualLine(2)).toBe(-1);
        state.restoreSelections([createCursorSelection(2, 0)]);
        expect(state.logicalToVisualLine(2)).toBeGreaterThanOrEqual(0);
        expect(state.foldedRegions[0].isCollapsed).toBe(false);
    });

    it("ensurePrimaryCursorVisible is a no-op with no selections", () => {
        const doc = new TextDocument("a\nb\nc");
        const state = new EditorViewState(doc);
        state.selections = [];
        expect(() => {
            state.ensurePrimaryCursorVisible();
        }).not.toThrow();
    });
});

describe("EditorViewState folding adjustment — edit spans out of region", () => {
    it("drops a region when the edit starts inside it and ends past its end", () => {
        const doc = new TextDocument("a\nb\nc\nd\ne\nf");
        const state = new EditorViewState(doc, [
            { anchor: { line: 2, character: 0 }, active: { line: 4, character: 1 } },
        ]);
        state.setFoldingRegions([createFoldingRegion(1, 3, false)]);
        state.type("Z");
        expect(state.foldedRegions).toHaveLength(0);
    });
});

describe("EditorViewState word navigation — boundary returns", () => {
    it("cursorWordLeft lands at column 0 when only whitespace precedes the cursor", () => {
        const doc = new TextDocument("   x");
        const state = new EditorViewState(doc, [createCursorSelection(0, 3)]);
        state.cursorWordLeft();
        expect(state.selections[0].active.character).toBe(0);
    });

    it("cursorWordRight stays at line end when the cursor is already at the end", () => {
        const doc = new TextDocument("abc");
        const state = new EditorViewState(doc, [createCursorSelection(0, 3)]);
        state.cursorWordRight();
        expect(state.selections[0].active.character).toBe(3);
    });
});
