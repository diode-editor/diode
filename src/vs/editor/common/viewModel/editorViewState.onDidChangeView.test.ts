import { describe, expect, it } from "vitest";

import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

function createState(): EditorViewState {
    return new EditorViewState(new TextDocument("a\nb\nc\nd\ne"));
}

describe("EditorViewState.onDidChangeView", () => {
    it("fires on scrollTop/scrollLeft change, but not on assigning the same value", () => {
        const state = createState();
        let fired = 0;
        state.onDidChangeView(() => fired++);

        state.scrollTop = 2;
        expect(fired).toBe(1);
        state.scrollTop = 2; // same value — no event
        expect(fired).toBe(1);
        expect(state.scrollTop).toBe(2);

        state.scrollLeft = 3;
        expect(fired).toBe(2);
        state.scrollLeft = 3;
        expect(fired).toBe(2);
        expect(state.scrollLeft).toBe(3);
    });

    it("fires on search highlights and the active match index", () => {
        const state = createState();
        let fired = 0;
        state.onDidChangeView(() => fired++);

        state.searchMatches = [{ start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }];
        expect(fired).toBe(1);
        expect(state.searchMatches).toHaveLength(1);

        state.currentSearchMatchIndex = 0;
        expect(fired).toBe(2);
        state.currentSearchMatchIndex = 0; // same index — no event
        expect(fired).toBe(2);
        expect(state.currentSearchMatchIndex).toBe(0);
    });

    it("dispose removes the subscription", () => {
        const state = createState();
        let fired = 0;
        const subscription = state.onDidChangeView(() => fired++);

        state.scrollTop = 1;
        expect(fired).toBe(1);

        subscription.dispose();
        subscription.dispose();
        state.scrollTop = 4;
        expect(fired).toBe(1);
    });
});
