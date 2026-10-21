import { describe, expect, it } from "vitest";

import { createFoldingRegion } from "../../contrib/folding/iFoldingRegion.ts";
import { createCursorSelection, createSelection } from "../core/iSelection.ts";
import { PlainTextTokenizer } from "../languages/builtin/plainTextTokenizer.ts";
import { TextDocument } from "../model/textDocument.ts";
import { DocumentTokenStore } from "../tokens/documentTokenStore.ts";

import { EditorViewState } from "./editorViewState.ts";

describe("EditorViewState.getViewLine — out of range", () => {
    it("returns empty string for a visual line past the end", () => {
        const doc = new TextDocument("a\nb");
        const state = new EditorViewState(doc);
        expect(state.getViewLine(99)).toBe("");
    });

    it("returns empty string for a negative visual line", () => {
        const doc = new TextDocument("a\nb");
        const state = new EditorViewState(doc);
        expect(state.getViewLine(-1)).toBe("");
    });
});

describe("EditorViewState.getViewLineTokens — out of range", () => {
    it("returns undefined when no token store is attached", () => {
        const doc = new TextDocument("a\nb");
        const state = new EditorViewState(doc);
        expect(state.getViewLineTokens(0)).toBeUndefined();
    });

    it("returns undefined for a visual line past the end even with a token store", () => {
        const doc = new TextDocument("a\nb");
        const state = new EditorViewState(doc);
        state.tokenStore = new DocumentTokenStore(doc, new PlainTextTokenizer());
        expect(state.getViewLineTokens(99)).toBeUndefined();
    });

    it("returns undefined for a negative visual line with a token store", () => {
        const doc = new TextDocument("a\nb");
        const state = new EditorViewState(doc);
        state.tokenStore = new DocumentTokenStore(doc, new PlainTextTokenizer());
        expect(state.getViewLineTokens(-1)).toBeUndefined();
    });
});

describe("EditorViewState.cursorRight — last-grapheme branch", () => {
    it("moves to line end when the cursor is on the final character", () => {
        const doc = new TextDocument("a\nbc");
        const state = new EditorViewState(doc, [createCursorSelection(0, 0)]);
        state.cursorRight();
        expect(state.selections[0].active).toEqual({ line: 0, character: 1 });
    });
});

describe("EditorViewState.deleteRight — boundary", () => {
    it("merges with the next line when the cursor is at end of line", () => {
        const doc = new TextDocument("ab\ncd");
        const state = new EditorViewState(doc, [createCursorSelection(0, 2)]);
        state.deleteRight();
        expect(doc.getText()).toBe("abcd");
    });

    it("deletes the grapheme under the cursor mid-line", () => {
        const doc = new TextDocument("abc");
        const state = new EditorViewState(doc, [createCursorSelection(0, 1)]);
        state.deleteRight();
        expect(doc.getText()).toBe("ac");
    });
});

describe("EditorViewState navigation from a collapsed (hidden) line", () => {
    it("cursorDown from a hidden line jumps to the first visible line below", () => {
        const doc = new TextDocument("a\nb\nc\nd\ne");
        const state = new EditorViewState(doc, [createCursorSelection(2, 0)]);
        state.setFoldingRegions([createFoldingRegion(1, 3, true)]);

        state.cursorDown();
        expect(state.selections[0].active.line).toBe(4);
    });

    it("cursorUp from a hidden line jumps to the last visible line above", () => {
        const doc = new TextDocument("a\nb\nc\nd\ne");
        const state = new EditorViewState(doc, [createCursorSelection(2, 0)]);
        state.setFoldingRegions([createFoldingRegion(1, 3, true)]);

        state.cursorUp();
        expect(state.selections[0].active.line).toBe(1);
    });
});

describe("EditorViewState folding adjustment on edits", () => {
    it("leaves a region untouched when the edit is entirely after it", () => {
        const doc = new TextDocument("a\nb\nc\nd\ne");
        const state = new EditorViewState(doc, [createCursorSelection(4, 1)]);
        state.setFoldingRegions([createFoldingRegion(0, 2, false)]);

        state.type("X");

        expect(state.foldedRegions).toHaveLength(1);
        expect(state.foldedRegions[0]).toMatchObject({ startLine: 0, endLine: 2 });
    });

    it("removes a region when the edit starts inside it and extends beyond its end", () => {
        const doc = new TextDocument("a\nb\nc\nd\ne\nf");
        const state = new EditorViewState(doc, [createSelection(2, 0, 5, 0)]);
        state.setFoldingRegions([createFoldingRegion(1, 3, false)]);

        state.type("Z");

        expect(state.foldedRegions).toHaveLength(0);
    });

    it("shifts a region down when an edit before it inserts lines", () => {
        const doc = new TextDocument("a\nb\nc\nd\ne");
        const state = new EditorViewState(doc, [createCursorSelection(0, 0)]);
        state.setFoldingRegions([createFoldingRegion(2, 4, false)]);

        state.type("\n");

        expect(state.foldedRegions[0]).toMatchObject({ startLine: 3, endLine: 5 });
    });

    it("removes a region when an edit starts inside it and extends past its end", () => {
        const doc = new TextDocument("a\nb\nc\nd\ne\nf");
        const state = new EditorViewState(doc, [createSelection(2, 0, 4, 1)]);
        state.setFoldingRegions([createFoldingRegion(1, 3, false)]);

        state.type("Q");

        expect(state.foldedRegions).toHaveLength(0);
    });
});

describe("EditorViewState.cursorLeft — wrap to previous visible line", () => {
    it("wraps from line start to the end of the fold header line, skipping hidden lines", () => {
        const doc = new TextDocument("header\nx\ny\ntail");
        const state = new EditorViewState(doc, [createCursorSelection(3, 0)]);
        state.setFoldingRegions([createFoldingRegion(0, 2, true)]);

        state.cursorLeft();

        expect(state.selections[0].active).toEqual({ line: 0, character: 6 });
    });
});

describe("EditorViewState.deleteRight — wide grapheme", () => {
    it("deletes a whole surrogate-pair emoji as one grapheme", () => {
        const doc = new TextDocument("😀ab");
        const state = new EditorViewState(doc, [createCursorSelection(0, 0)]);

        state.deleteRight();

        expect(doc.getText()).toBe("ab");
    });
});
