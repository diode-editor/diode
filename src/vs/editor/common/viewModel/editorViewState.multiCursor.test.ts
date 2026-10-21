import { describe, expect, it } from "vitest";

import { createFoldingRegion } from "../../contrib/folding/iFoldingRegion.ts";
import { createCursorSelection, createSelection } from "../core/iSelection.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

function actives(state: EditorViewState): number[][] {
    return state.selections.map((sel) => [sel.active.line, sel.active.character]);
}

function makeLines(count: number): string {
    return Array.from({ length: count }, (_, i) => `line ${i.toString()}`).join("\n");
}

describe("EditorViewState.insertCursorBelow / insertCursorAbove", () => {
    it("adds a cursor on the line below", () => {
        const state = new EditorViewState(new TextDocument("aaa\nbbb\nccc"), [createCursorSelection(0, 1)]);
        state.insertCursorBelow();
        expect(actives(state)).toEqual([
            [0, 1],
            [1, 1],
        ]);
    });

    it("adds a cursor on the line above", () => {
        const state = new EditorViewState(new TextDocument("aaa\nbbb\nccc"), [createCursorSelection(2, 2)]);
        state.insertCursorAbove();
        expect(actives(state)).toEqual([
            [1, 2],
            [2, 2],
        ]);
    });

    it("three Below presses grow the stack instead of doubling it", () => {
        const state = new EditorViewState(new TextDocument(makeLines(6)), [createCursorSelection(0, 0)]);
        state.insertCursorBelow();
        state.insertCursorBelow();
        state.insertCursorBelow();
        // Copies of the inner cursors coincide with existing ones and collapse on merge.
        expect(actives(state)).toEqual([
            [0, 0],
            [1, 0],
            [2, 0],
            [3, 0],
        ]);
    });

    it("Above on stack 3-4-5 extends it upward to 2-3-4-5", () => {
        const state = new EditorViewState(new TextDocument(makeLines(8)), [
            createCursorSelection(3, 0),
            createCursorSelection(4, 0),
            createCursorSelection(5, 0),
        ]);
        state.insertCursorAbove();
        expect(actives(state).map((pair) => pair[0])).toEqual([2, 3, 4, 5]);
    });

    it("on the last line Below does nothing and fires no event", () => {
        const state = new EditorViewState(new TextDocument("aaa\nbbb"), [createCursorSelection(1, 0)]);
        let fired = 0;
        state.onDidChangeCursorPosition(() => {
            fired++;
        });
        state.insertCursorBelow();
        expect(state.selections).toHaveLength(1);
        expect(fired).toBe(0);
    });

    it("on the first line Above does nothing", () => {
        const state = new EditorViewState(new TextDocument("aaa\nbbb"), [createCursorSelection(0, 0)]);
        state.insertCursorAbove();
        expect(state.selections).toHaveLength(1);
    });

    it("idealColumn survives a short line on the way down", () => {
        const state = new EditorViewState(new TextDocument("abcdefgh\nxy\nabcdefgh"), [createCursorSelection(0, 6)]);
        state.insertCursorBelow();
        state.insertCursorBelow();
        expect(actives(state)).toEqual([
            [0, 6],
            [1, 2], // shorter line — cursor clamped to its end
            [2, 6], // but the remembered column brings it back
        ]);
    });

    it("ideal column is computed by display, not by offset (tabs)", () => {
        const doc = new TextDocument("\t\tx\n________x");
        const state = new EditorViewState(doc, [createCursorSelection(0, 2)]);
        state.tabSize = 4;
        state.insertCursorBelow();
        // Two tabs are 8 display columns, so on the underscore line the cursor
        // lands at offset 8, not 2.
        expect(actives(state)).toEqual([
            [0, 2],
            [1, 8],
        ]);
    });

    it("a collapsed region is skipped entirely", () => {
        const doc = new TextDocument("header\nbody 1\nbody 2\nafter");
        const state = new EditorViewState(doc, [createCursorSelection(0, 0)]);
        state.foldedRegions = [createFoldingRegion(0, 2, true)];
        state.insertCursorBelow();
        expect(actives(state)).toEqual([
            [0, 0],
            [3, 0],
        ]);
        for (const sel of state.selections) {
            expect(state.logicalToVisualLine(sel.active.line)).toBeGreaterThanOrEqual(0);
        }
    });

    it("a zone line does not eat the step: the cursor lands on a document line", () => {
        const state = new EditorViewState(new TextDocument("aaa\nbbb\nccc"), [createCursorSelection(0, 0)]);
        state.setViewZones([{ afterLine: 0, size: 1 }]);
        state.insertCursorBelow();
        expect(actives(state)).toEqual([
            [0, 0],
            [1, 0],
        ]);
    });

    it("a non-empty selection moves whole instead of collapsing to a cursor", () => {
        const state = new EditorViewState(new TextDocument("abcdef\nabcdef"), [createSelection(0, 1, 0, 4)]);
        state.insertCursorBelow();
        expect(state.selections).toHaveLength(2);
        expect(state.selections[1].anchor).toEqual({ line: 1, character: 1 });
        expect(state.selections[1].active).toEqual({ line: 1, character: 4 });
    });

    it("a selection moves up too, both ends one line higher", () => {
        const state = new EditorViewState(new TextDocument("abcdef\nabcdef\nabcdef"), [createSelection(2, 1, 2, 4)]);
        state.insertCursorAbove();
        expect(state.selections).toHaveLength(2);
        expect(state.selections[0].anchor).toEqual({ line: 1, character: 1 });
        expect(state.selections[0].active).toEqual({ line: 1, character: 4 });
    });

    it("a selection from the second line moves to line zero", () => {
        // The anchor lands exactly on line zero — the "nowhere to move" edge case
        // is checked on the line below zero, not on line zero itself.
        const state = new EditorViewState(new TextDocument("abcdef\nabcdef\nabcdef"), [createSelection(1, 1, 1, 4)]);

        state.insertCursorAbove();

        expect(state.selections).toHaveLength(2);
        expect(state.selections[0].anchor).toEqual({ line: 0, character: 1 });
        expect(state.selections[0].active).toEqual({ line: 0, character: 4 });
    });

    it("a reversed selection at the document edge makes no copy and sends no event", () => {
        // An anchor on the last line can't move but active can: the copy would lie entirely
        // inside the original selection, and the merge would swallow it without a trace.
        const state = new EditorViewState(new TextDocument("aaa\nbbb\nccc"), [createSelection(2, 0, 1, 0)]);
        let fired = 0;
        state.onDidChangeCursorPosition(() => {
            fired++;
        });
        state.insertCursorBelow();
        expect(state.selections).toHaveLength(1);
        expect(fired).toBe(0);
    });

    it("viewport follows the new cursor up", () => {
        const state = new EditorViewState(new TextDocument(makeLines(40)), [createCursorSelection(30, 0)]);
        state.viewportHeight = 10;
        state.viewportWidth = 40;
        state.scrollTop = 30; // cursor on the first visible line

        state.insertCursorAbove();

        // The TOP cursor must be revealed — it is the new one. Revealing the bottom one
        // wouldn't move the viewport: it is already on screen.
        expect(state.scrollTop).toBe(29);
    });

    it("viewport follows the new cursor down", () => {
        const state = new EditorViewState(new TextDocument(makeLines(40)), [createCursorSelection(9, 0)]);
        state.viewportHeight = 10;
        state.viewportWidth = 40;
        expect(state.scrollTop).toBe(0);
        state.insertCursorBelow();
        expect(state.scrollTop).toBe(1);
    });
});

describe("EditorViewState.removeSecondaryCursors", () => {
    it("keeps the primary cursor", () => {
        const state = new EditorViewState(new TextDocument("aaa\nbbb\nccc"), [
            createCursorSelection(0, 1),
            createCursorSelection(2, 2),
        ]);
        state.removeSecondaryCursors();
        expect(actives(state)).toEqual([[0, 1]]);
    });

    it("with a single cursor — no-op without an event", () => {
        const state = new EditorViewState(new TextDocument("aaa"), [createCursorSelection(0, 1)]);
        let fired = 0;
        state.onDidChangeCursorPosition(() => {
            fired++;
        });
        state.removeSecondaryCursors();
        expect(fired).toBe(0);
    });

    it("pulls the viewport to the surviving cursor", () => {
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
    it("adds a cursor at a free spot", () => {
        const state = new EditorViewState(new TextDocument("aaa\nbbb"), [createCursorSelection(0, 0)]);
        state.toggleCursorAt(1, 2);
        expect(actives(state)).toEqual([
            [0, 0],
            [1, 2],
        ]);
    });

    it("removes a cursor on an exact hit", () => {
        const state = new EditorViewState(new TextDocument("aaa\nbbb"), [
            createCursorSelection(0, 0),
            createCursorSelection(1, 2),
        ]);
        state.toggleCursorAt(1, 2);
        expect(actives(state)).toEqual([[0, 0]]);
    });

    it("a click inside a selection removes it entirely", () => {
        const state = new EditorViewState(new TextDocument("abcdef\nbbb"), [
            createSelection(0, 1, 0, 5),
            createCursorSelection(1, 0),
        ]);
        state.toggleCursorAt(0, 3);
        expect(actives(state)).toEqual([[1, 0]]);
    });

    it("does not remove the last cursor", () => {
        const state = new EditorViewState(new TextDocument("aaa"), [createCursorSelection(0, 1)]);
        let fired = 0;
        state.onDidChangeCursorPosition(() => {
            fired++;
        });
        state.toggleCursorAt(0, 1);
        expect(actives(state)).toEqual([[0, 1]]);
        expect(fired).toBe(0);
    });

    it("viewport follows the added cursor", () => {
        const state = new EditorViewState(new TextDocument(makeLines(60)), [createCursorSelection(0, 0)]);
        state.viewportHeight = 10;
        state.viewportWidth = 40;
        state.toggleCursorAt(30, 0);
        expect(state.scrollTop).toBeGreaterThan(0);
    });
});

describe("EditorViewState.revealSelection", () => {
    it("unfolds a fold hiding the target", () => {
        const doc = new TextDocument("header\nbody 1\nbody 2\nafter");
        const state = new EditorViewState(doc, [createCursorSelection(0, 0)]);
        state.viewportHeight = 10;
        state.viewportWidth = 40;
        state.foldedRegions = [createFoldingRegion(0, 2, true)];
        state.revealSelection(createCursorSelection(2, 0));
        expect(state.foldedRegions[0].isCollapsed).toBe(false);
    });

    it("unfolds folds above both the start and the end of the selection", () => {
        const state = new EditorViewState(new TextDocument(makeLines(8)), [createCursorSelection(0, 0)]);
        state.viewportHeight = 10;
        state.viewportWidth = 40;
        state.foldedRegions = [createFoldingRegion(0, 2, true), createFoldingRegion(4, 6, true)];

        state.revealSelection(createSelection(1, 0, 5, 0));

        // Either end of a selection can hide it, so both must be unfolded: a check on
        // the cursor can't see this — there start and end coincide.
        expect(state.foldedRegions.map((region) => region.isCollapsed)).toEqual([false, false]);
    });

    it("scrolls to the given selection, not to the primary one", () => {
        const state = new EditorViewState(new TextDocument(makeLines(60)), [createCursorSelection(0, 0)]);
        state.viewportHeight = 10;
        state.viewportWidth = 40;
        state.revealSelection(createSelection(40, 0, 40, 3));
        expect(state.scrollTop).toBeGreaterThan(0);
    });
});

describe("EditorViewState.getSelectedTexts", () => {
    it("text of each selection in document order", () => {
        const doc = new TextDocument("alpha\nbeta");
        const state = new EditorViewState(doc, [createSelection(1, 0, 1, 4), createSelection(0, 0, 0, 5)]);
        expect(state.getSelectedTexts()).toEqual(["alpha", "beta"]);
    });

    it("a collapsed cursor yields an empty string", () => {
        const doc = new TextDocument("alpha\nbeta");
        const state = new EditorViewState(doc, [createSelection(0, 0, 0, 5), createCursorSelection(1, 2)]);
        expect(state.getSelectedTexts()).toEqual(["alpha", ""]);
    });
});
