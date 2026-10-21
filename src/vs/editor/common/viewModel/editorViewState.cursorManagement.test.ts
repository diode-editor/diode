import { describe, expect, it } from "vitest";

import { createFoldingRegion } from "../../contrib/folding/iFoldingRegion.ts";
import { editorState, expectEditorState, parseDSL, renderToDSL } from "../../test/common/trackDSL.ts";
import { createCursorSelection, createSelection } from "../core/iSelection.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

describe("EditorViewState.Folding — basic mapping", () => {
    it("getViewLineCount equals document lineCount when no folds", () => {
        const state = parseDSL(editorState`
            text: line 0
            text: line 1
            text: line 2
            cursor: █
        `);
        expect(state.getViewLineCount()).toBe(3);
    });

    it("getViewLineCount accounts for a single collapsed region", () => {
        const state = parseDSL(editorState`
            text: function foo() {
            folding: >
            text:   console.log(1);
            folding: |
            text:   console.log(2);
            folding: |
            text: }
            folding: ^
            cursor: █
        `);
        expect(state.getViewLineCount()).toBe(1);
    });

    it("getViewLine skips collapsed lines", () => {
        const state = parseDSL(editorState`
            text: header
            folding: >
            text:   body1
            folding: |
            text:   body2
            folding: ^
            text: footer
            cursor: █
        `);
        expect(state.getViewLineCount()).toBe(2);
        expect(state.getViewLine(0)).toBe("header");
        expect(state.getViewLine(1)).toBe("footer");
    });

    it("getViewLine works with multiple collapsed regions", () => {
        const state = parseDSL(editorState`
            text: a
            folding: >
            text: b
            folding: ^
            text: c
            folding: >
            text: d
            folding: ^
            text: e
            cursor: █
        `);
        expect(state.getViewLineCount()).toBe(3);
        expect(state.getViewLine(0)).toBe("a");
        expect(state.getViewLine(1)).toBe("c");
        expect(state.getViewLine(2)).toBe("e");
    });

    it("all expanded means viewLineCount equals document lineCount", () => {
        const state = parseDSL(editorState`
            text: a
            folding: v
            text: b
            folding: |
            text: c
            folding: ^
            cursor: █
        `);
        expect(state.getViewLineCount()).toBe(3);
        expect(state.getViewLine(0)).toBe("a");
        expect(state.getViewLine(1)).toBe("b");
        expect(state.getViewLine(2)).toBe("c");
    });

    it("logicalToVisualLine returns -1 for hidden lines", () => {
        const state = parseDSL(editorState`
            text: a
            folding: >
            text: b
            folding: |
            text: c
            folding: ^
            text: d
            cursor: █
        `);
        expect(state.logicalToVisualLine(0)).toBe(0);
        expect(state.logicalToVisualLine(1)).toBe(-1);
        expect(state.logicalToVisualLine(2)).toBe(-1);
        expect(state.logicalToVisualLine(3)).toBe(1);
    });

    it("visualToLogicalLine maps correctly", () => {
        const state = parseDSL(editorState`
            text: a
            folding: >
            text: b
            folding: |
            text: c
            folding: ^
            text: d
            cursor: █
        `);
        expect(state.visualToLogicalLine(0)).toBe(0);
        expect(state.visualToLogicalLine(1)).toBe(3);
        expect(state.visualToLogicalLine(2)).toBe(-1);
    });
});

describe("EditorViewState.Folding — cursor navigation", () => {
    it("cursorDown skips collapsed region", () => {
        const state = parseDSL(editorState`
            text: header
            folding: >
            cursor: █
            text:   body1
            folding: |
            text:   body2
            folding: ^
            text: footer
        `);
        state.cursorDown();
        expectEditorState(
            state,
            editorState`
            text: header
            folding: >
            text:   body1
            folding: |
            text:   body2
            folding: ^
            text: footer
            cursor: █
        `,
        );
    });

    it("cursorUp skips collapsed region", () => {
        const state = parseDSL(editorState`
            text: header
            folding: >
            text:   body1
            folding: |
            text:   body2
            folding: ^
            text: footer
            cursor: █
        `);
        state.cursorUp();
        expectEditorState(
            state,
            editorState`
            text: header
            cursor: █
            folding: >
            text:   body1
            folding: |
            text:   body2
            folding: ^
            text: footer
        `,
        );
    });

    it("cursorDown does nothing at last visible line", () => {
        const state = parseDSL(editorState`
            text: a
            folding: >
            text: b
            folding: ^
            text: c
            cursor: █
        `);
        state.cursorDown();
        expect(state.selections[0].active.line).toBe(2);
    });

    it("cursorUp does nothing at first line", () => {
        const state = parseDSL(editorState`
            text: a
            folding: >
            cursor: █
            text: b
            folding: ^
            text: c
        `);
        state.cursorUp();
        expect(state.selections[0].active.line).toBe(0);
    });

    it("cursorRight wraps to next visible line, skipping collapsed", () => {
        const state = parseDSL(editorState`
            text: ab
            folding: >
            cursor:   █
            text: cd
            folding: ^
            text: ef
        `);
        state.cursorRight();
        expect(state.selections[0].active.line).toBe(2);
        expect(state.selections[0].active.character).toBe(0);
    });

    it("cursorLeft wraps to previous visible line, skipping collapsed", () => {
        const state = parseDSL(editorState`
            text: ab
            folding: >
            text: cd
            folding: ^
            text: ef
            cursor: █
        `);
        state.cursorLeft();
        expect(state.selections[0].active.line).toBe(0);
        expect(state.selections[0].active.character).toBe(2);
    });

    it("cursorDown clamps character to target line length", () => {
        const state = parseDSL(editorState`
            text: longline
            folding: >
            cursor:      █
            text: hid
            folding: ^
            text: xy
        `);
        state.cursorDown();
        expect(state.selections[0].active.line).toBe(2);
        expect(state.selections[0].active.character).toBe(2);
    });
});

describe("EditorViewState.Folding — auto-expand", () => {
    it("ensureLineVisible expands collapsed region containing the line", () => {
        const state = parseDSL(editorState`
            text: a
            folding: >
            text: b
            folding: |
            text: c
            folding: ^
            cursor: █
        `);
        expect(state.foldedRegions[0].isCollapsed).toBe(true);
        state.ensureLineVisible(1);
        expect(state.foldedRegions[0].isCollapsed).toBe(false);
    });

    it("ensureLineVisible is no-op for visible lines", () => {
        const state = parseDSL(editorState`
            text: a
            folding: >
            text: b
            folding: ^
            text: c
            cursor: █
        `);
        state.ensureLineVisible(0);
        expect(state.foldedRegions[0].isCollapsed).toBe(true);
        state.ensureLineVisible(2);
        expect(state.foldedRegions[0].isCollapsed).toBe(true);
    });

    it("ensureLineVisible does not expand region if line is the startLine", () => {
        const state = parseDSL(editorState`
            text: a
            folding: >
            text: b
            folding: ^
            cursor: █
        `);
        state.ensureLineVisible(0);
        expect(state.foldedRegions[0].isCollapsed).toBe(true);
    });
});

describe("EditorViewState.Folding — toggle and foldAll/unfoldAll", () => {
    it("toggleFold collapses an expanded region", () => {
        const state = parseDSL(editorState`
            text: a
            folding: v
            text: b
            folding: ^
            cursor: █
        `);
        expect(state.foldedRegions[0].isCollapsed).toBe(false);
        state.toggleFold(0);
        expect(state.foldedRegions[0].isCollapsed).toBe(true);
    });

    it("toggleFold expands a collapsed region", () => {
        const state = parseDSL(editorState`
            text: a
            folding: >
            text: b
            folding: ^
            cursor: █
        `);
        expect(state.foldedRegions[0].isCollapsed).toBe(true);
        state.toggleFold(0);
        expect(state.foldedRegions[0].isCollapsed).toBe(false);
    });

    it("toggleFold is no-op if no region at line", () => {
        const state = parseDSL(editorState`
            text: a
            folding: v
            text: b
            folding: ^
            cursor: █
        `);
        state.toggleFold(1);
        expect(state.foldedRegions[0].isCollapsed).toBe(false);
    });

    it("foldAll collapses all regions", () => {
        const state = parseDSL(editorState`
            text: a
            folding: v
            text: b
            folding: ^
            text: c
            folding: v
            text: d
            folding: ^
            cursor: █
        `);
        state.foldAll();
        expect(state.foldedRegions.every((r) => r.isCollapsed)).toBe(true);
    });

    it("unfoldAll expands all regions", () => {
        const state = parseDSL(editorState`
            text: a
            folding: >
            text: b
            folding: ^
            text: c
            folding: >
            text: d
            folding: ^
            cursor: █
        `);
        state.unfoldAll();
        expect(state.foldedRegions.every((r) => !r.isCollapsed)).toBe(true);
    });
});

describe("EditorViewState.Folding — edit tracking", () => {
    it("inserting lines above a region shifts its boundaries", () => {
        const doc = new TextDocument("a\nb\nc\nd");
        const state = new EditorViewState(doc, [createCursorSelection(0, 1)]);
        state.setFoldingRegions([createFoldingRegion(2, 3, false)]);

        state.type("\n");

        expect(state.foldedRegions[0].startLine).toBe(3);
        expect(state.foldedRegions[0].endLine).toBe(4);
    });

    it("inserting lines inside an expanded region shifts endLine", () => {
        const doc = new TextDocument("a\nb\nc");
        const state = new EditorViewState(doc, [createCursorSelection(1, 1)]);
        state.setFoldingRegions([createFoldingRegion(0, 2, false)]);

        state.type("\n");

        expect(state.foldedRegions[0].startLine).toBe(0);
        expect(state.foldedRegions[0].endLine).toBe(3);
    });

    it("deleting lines above a region shifts its boundaries down", () => {
        const doc = new TextDocument("x\na\nb\nc");
        const state = new EditorViewState(doc, [createCursorSelection(1, 0)]);
        state.setFoldingRegions([createFoldingRegion(2, 3, false)]);

        state.deleteLeft();

        expect(state.foldedRegions[0].startLine).toBe(1);
        expect(state.foldedRegions[0].endLine).toBe(2);
    });

    it("edit crossing region boundary removes the region", () => {
        const doc = new TextDocument("a\nb\nc\nd");
        const state = new EditorViewState(doc, [createCursorSelection(1, 0)]);
        state.setFoldingRegions([createFoldingRegion(0, 1, false)]);

        // deleteLeft at the start of line 1 joins it with 0 — the edit crosses the region's startLine.
        state.deleteLeft();

        expect(state.foldedRegions.length).toBe(0);
    });
});

describe("EditorViewState.CursorManagement", () => {
    it("cursorDown through short line preserves idealColumn", () => {
        const doc = new TextDocument("abcdef\nhi\nxyzwv");
        const state = new EditorViewState(doc, [createCursorSelection(0, 5)]);
        state.cursorDown();
        expect(state.selections[0].active).toEqual({ line: 1, character: 2 });
        state.cursorDown();
        expect(state.selections[0].active).toEqual({ line: 2, character: 5 });
    });

    it("cursorUp through short line preserves idealColumn", () => {
        const doc = new TextDocument("xyzwv\nhi\nabcdef");
        const state = new EditorViewState(doc, [createCursorSelection(2, 5)]);
        state.cursorUp();
        expect(state.selections[0].active).toEqual({ line: 1, character: 2 });
        state.cursorUp();
        expect(state.selections[0].active).toEqual({ line: 0, character: 5 });
    });

    it("cursorEnd then cursorDown sticks to right edge", () => {
        const doc = new TextDocument("short\nlonger line\nhi");
        const state = new EditorViewState(doc, [createCursorSelection(0, 0)]);
        state.cursorEnd();
        expect(state.selections[0].active).toEqual({ line: 0, character: 5 });

        state.cursorDown();
        expect(state.selections[0].active).toEqual({ line: 1, character: 11 });

        state.cursorDown();
        expect(state.selections[0].active).toEqual({ line: 2, character: 2 });
    });

    it("cursorHome sets activeColumn and idealColumn to 0", () => {
        const doc = new TextDocument("hello\nworld");
        const state = new EditorViewState(doc, [createCursorSelection(0, 3)]);
        state.cursorHome();
        expect(state.selections[0].active).toEqual({ line: 0, character: 0 });

        state.cursorDown();
        expect(state.selections[0].active).toEqual({ line: 1, character: 0 });
    });

    it("cursorHome jumps to the first non-whitespace character on a space-indented line", () => {
        const doc = new TextDocument("    hello");
        const state = new EditorViewState(doc, [createCursorSelection(0, 6)]);
        state.cursorHome();
        expect(state.selections[0].active).toEqual({ line: 0, character: 4 });
    });

    it("cursorHome toggles between first non-whitespace and column 0", () => {
        const doc = new TextDocument("    hello");
        const state = new EditorViewState(doc, [createCursorSelection(0, 6)]);
        state.cursorHome();
        expect(state.selections[0].active).toEqual({ line: 0, character: 4 });
        state.cursorHome();
        expect(state.selections[0].active).toEqual({ line: 0, character: 0 });
        state.cursorHome();
        expect(state.selections[0].active).toEqual({ line: 0, character: 4 });
    });

    it("cursorHome jumps to first non-whitespace from within the indent", () => {
        const doc = new TextDocument("    hello");
        const state = new EditorViewState(doc, [createCursorSelection(0, 2)]);
        state.cursorHome();
        expect(state.selections[0].active).toEqual({ line: 0, character: 4 });
    });

    it("cursorHome sets idealColumn to the display column of the target with tabs", () => {
        const doc = new TextDocument("\thello\n\tworld");
        const state = new EditorViewState(doc, [createCursorSelection(0, 3)]);
        state.cursorHome();
        expect(state.selections[0].active).toEqual({ line: 0, character: 1 });
        state.cursorDown();
        expect(state.selections[0].active).toEqual({ line: 1, character: 1 });
    });

    it("cursorHome goes straight to column 0 on a line without indentation", () => {
        const doc = new TextDocument("hello");
        const state = new EditorViewState(doc, [createCursorSelection(0, 3)]);
        state.cursorHome();
        expect(state.selections[0].active).toEqual({ line: 0, character: 0 });
        state.cursorHome();
        expect(state.selections[0].active).toEqual({ line: 0, character: 0 });
    });

    it("cursorHome toggles on an all-whitespace line without throwing", () => {
        const doc = new TextDocument("    ");
        const state = new EditorViewState(doc, [createCursorSelection(0, 4)]);
        state.cursorHome(); // active === firstNonWs (line length 4) → column 0
        expect(state.selections[0].active).toEqual({ line: 0, character: 0 });
        state.cursorHome();
        expect(state.selections[0].active).toEqual({ line: 0, character: 4 });
    });

    it("cursorHome smart-homes each cursor independently in multi-cursor mode", () => {
        const doc = new TextDocument("    hello\n  world");
        const state = new EditorViewState(doc, [createCursorSelection(0, 6), createCursorSelection(1, 5)]);
        state.cursorHome();
        expect(state.selections[0].active).toEqual({ line: 0, character: 4 });
        expect(state.selections[1].active).toEqual({ line: 1, character: 2 });
    });

    it("cursorLeft resets idealColumn", () => {
        const doc = new TextDocument("abcdef\nhi\nabcdef");
        const state = new EditorViewState(doc, [createCursorSelection(0, 5)]);
        state.cursorDown();
        state.cursorLeft();
        state.cursorDown();
        expect(state.selections[0].active).toEqual({ line: 2, character: 1 });
    });

    it("cursorRight resets idealColumn", () => {
        const doc = new TextDocument("abcdef\nhi\nabcdef");
        const state = new EditorViewState(doc, [createCursorSelection(0, 5)]);
        state.cursorDown();
        state.cursorRight();
        state.cursorDown();
        expect(state.selections[0].active).toEqual({ line: 2, character: 0 });
    });

    it("cursorRight with inSelectionMode creates selection", () => {
        const doc = new TextDocument("hello");
        const state = new EditorViewState(doc, [createCursorSelection(0, 2)]);
        state.cursorRight(true);
        expect(state.selections[0].active).toEqual({ line: 0, character: 3 });
        expect(state.selections[0].anchor).toEqual({ line: 0, character: 2 });
    });

    it("cursorLeft with inSelectionMode creates selection", () => {
        const doc = new TextDocument("hello");
        const state = new EditorViewState(doc, [createCursorSelection(0, 3)]);
        state.cursorLeft(true);
        expect(state.selections[0].active).toEqual({ line: 0, character: 2 });
        expect(state.selections[0].anchor).toEqual({ line: 0, character: 3 });
    });

    it("cursorDown with inSelectionMode extends selection downward", () => {
        const doc = new TextDocument("hello\nworld");
        const state = new EditorViewState(doc, [createCursorSelection(0, 2)]);
        state.cursorDown(true);
        expect(state.selections[0].active).toEqual({ line: 1, character: 2 });
        expect(state.selections[0].anchor).toEqual({ line: 0, character: 2 });
    });

    it("cursorUp with inSelectionMode extends selection upward", () => {
        const doc = new TextDocument("hello\nworld");
        const state = new EditorViewState(doc, [createCursorSelection(1, 3)]);
        state.cursorUp(true);
        expect(state.selections[0].active).toEqual({ line: 0, character: 3 });
        expect(state.selections[0].anchor).toEqual({ line: 1, character: 3 });
    });

    it("cursorRight without selection mode collapses existing selection", () => {
        const doc = new TextDocument("hello");
        const state = new EditorViewState(doc, [createSelection(0, 1, 0, 4)]);
        state.cursorRight();
        expect(state.selections[0].active).toEqual({ line: 0, character: 5 });
        expect(state.selections[0].anchor).toEqual({ line: 0, character: 5 });
    });

    it("cursorEnd with inSelectionMode selects to end of line", () => {
        const doc = new TextDocument("hello world");
        const state = new EditorViewState(doc, [createCursorSelection(0, 3)]);
        state.cursorEnd(true);
        expect(state.selections[0].active).toEqual({ line: 0, character: 11 });
        expect(state.selections[0].anchor).toEqual({ line: 0, character: 3 });
    });

    it("cursorHome with inSelectionMode selects to start of line", () => {
        const doc = new TextDocument("hello world");
        const state = new EditorViewState(doc, [createCursorSelection(0, 5)]);
        state.cursorHome(true);
        expect(state.selections[0].active).toEqual({ line: 0, character: 0 });
        expect(state.selections[0].anchor).toEqual({ line: 0, character: 5 });
    });

    it("cursorHome with inSelectionMode selects to the first non-whitespace character", () => {
        const doc = new TextDocument("    hello");
        const state = new EditorViewState(doc, [createCursorSelection(0, 7)]);
        state.cursorHome(true);
        expect(state.selections[0].active).toEqual({ line: 0, character: 4 });
        expect(state.selections[0].anchor).toEqual({ line: 0, character: 7 });
    });

    it("normalizeSelections sorts cursors by document order", () => {
        const doc = new TextDocument("aaa\nbbb\nccc");
        const state = new EditorViewState(doc, [createCursorSelection(2, 0), createCursorSelection(0, 0)]);
        state.cursorRight();
        expect(state.selections[0].active.line).toBe(0);
        expect(state.selections[1].active.line).toBe(2);
    });
});

describe("EditorViewState.Scroll — ensureCursorVisible", () => {
    function makeLines(count: number): string {
        return Array.from({ length: count }, (_, i) => `line ${i.toString()}`).join("\n");
    }

    it("scrollTop increases when cursor moves below viewport", () => {
        const doc = new TextDocument(makeLines(10));
        const state = new EditorViewState(doc);
        state.viewportHeight = 5;
        state.viewportWidth = 80;
        for (let i = 0; i < 5; i++) state.cursorDown();
        expect(state.scrollTop).toBe(1);
    });

    it("scrollTop decreases when cursor moves above viewport", () => {
        const doc = new TextDocument(makeLines(10));
        const state = new EditorViewState(doc, [createCursorSelection(7, 0)]);
        state.viewportHeight = 5;
        state.viewportWidth = 80;
        state.scrollTop = 5;
        for (let i = 0; i < 3; i++) state.cursorUp();
        expect(state.scrollTop).toBe(4);
    });

    it("scrollRight when cursorEnd on long line", () => {
        const doc = new TextDocument("a".repeat(100));
        const state = new EditorViewState(doc);
        state.viewportWidth = 20;
        state.viewportHeight = 5;
        state.cursorEnd();
        expect(state.scrollLeft).toBe(81);
    });

    it("scrollLeft resets when cursorHome", () => {
        const doc = new TextDocument("a".repeat(100));
        const state = new EditorViewState(doc, [createCursorSelection(0, 50)]);
        state.viewportWidth = 20;
        state.viewportHeight = 5;
        state.scrollLeft = 40;
        state.cursorHome();
        expect(state.scrollLeft).toBe(0);
    });

    it("scrollTop adjusts with collapsed folding regions", () => {
        const doc = new TextDocument(makeLines(20));
        const state = new EditorViewState(doc);
        state.viewportHeight = 5;
        state.viewportWidth = 80;
        state.setFoldingRegions([createFoldingRegion(2, 5, true)]);
        for (let i = 0; i < 5; i++) state.cursorDown();
        expect(state.selections[0].active.line).toBeGreaterThanOrEqual(6);
        expect(state.scrollTop).toBeGreaterThanOrEqual(1);
    });

    it("type triggers scroll when inserting newline at bottom of viewport", () => {
        const doc = new TextDocument(makeLines(5));
        const state = new EditorViewState(doc, [createCursorSelection(4, 6)]);
        state.viewportHeight = 5;
        state.viewportWidth = 80;
        state.type("\n");
        expect(state.scrollTop).toBe(1);
    });

    it("deleteLeft on first visible line can scroll up", () => {
        const doc = new TextDocument(makeLines(10));
        const state = new EditorViewState(doc, [createCursorSelection(5, 0)]);
        state.viewportHeight = 5;
        state.viewportWidth = 80;
        state.scrollTop = 5;
        state.deleteLeft();
        expect(state.selections[0].active.line).toBe(4);
        expect(state.scrollTop).toBe(4);
    });

    it("scroll does not change when cursor is already visible", () => {
        const doc = new TextDocument(makeLines(10));
        const state = new EditorViewState(doc, [createCursorSelection(2, 3)]);
        state.viewportHeight = 5;
        state.viewportWidth = 80;
        state.cursorRight();
        expect(state.scrollTop).toBe(0);
        expect(state.scrollLeft).toBe(0);
    });
});
