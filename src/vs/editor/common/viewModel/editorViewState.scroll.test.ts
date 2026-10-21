import { describe, expect, it } from "vitest";

import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

describe("EditorViewState scrollLineDown", () => {
    it("increases scrollTop by 1", () => {
        const doc = new TextDocument("a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk");
        const state = new EditorViewState(doc);
        state.viewportHeight = 5;
        state.scrollLineDown();
        expect(state.scrollTop).toBe(1);
    });

    it("does not exceed maxScrollTop (lineCount - viewportHeight)", () => {
        const doc = new TextDocument("a\nb\nc\nd\ne\nf");
        const state = new EditorViewState(doc);
        state.viewportHeight = 4;
        state.scrollTop = 2;
        state.scrollLineDown();
        expect(state.scrollTop).toBe(2);
    });

    it("does not go negative when doc fits in viewport", () => {
        const doc = new TextDocument("a\nb");
        const state = new EditorViewState(doc);
        state.viewportHeight = 10;
        state.scrollLineDown();
        expect(state.scrollTop).toBe(0);
    });
});

describe("EditorViewState scrollLineUp", () => {
    it("decreases scrollTop by 1", () => {
        const doc = new TextDocument("a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk");
        const state = new EditorViewState(doc);
        state.viewportHeight = 5;
        state.scrollTop = 3;
        state.scrollLineUp();
        expect(state.scrollTop).toBe(2);
    });

    it("does not go below 0", () => {
        const doc = new TextDocument("a\nb\nc");
        const state = new EditorViewState(doc);
        state.viewportHeight = 5;
        state.scrollTop = 0;
        state.scrollLineUp();
        expect(state.scrollTop).toBe(0);
    });
});
