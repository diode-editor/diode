import { describe, expect, it } from "vitest";

import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

// onDidChangeView — уведомление о визуальных изменениях view-состояния мимо
// курсора (скролл, фолдинг, подсветка поиска): под damage-tracking редактор
// помечает себя по нему на перерисовку (контракт markDirty, docs/LAYOUT.md).

function createState(): EditorViewState {
    return new EditorViewState(new TextDocument("a\nb\nc\nd\ne"));
}

describe("EditorViewState.onDidChangeView", () => {
    it("стреляет на смену scrollTop/scrollLeft, но не на присвоение того же значения", () => {
        const state = createState();
        let fired = 0;
        state.onDidChangeView(() => fired++);

        state.scrollTop = 2;
        expect(fired).toBe(1);
        state.scrollTop = 2; // то же значение — молчит
        expect(fired).toBe(1);
        expect(state.scrollTop).toBe(2);

        state.scrollLeft = 3;
        expect(fired).toBe(2);
        state.scrollLeft = 3;
        expect(fired).toBe(2);
        expect(state.scrollLeft).toBe(3);
    });

    it("стреляет на подсветку поиска и индекс активного матча", () => {
        const state = createState();
        let fired = 0;
        state.onDidChangeView(() => fired++);

        state.searchMatches = [{ start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }];
        expect(fired).toBe(1);
        expect(state.searchMatches).toHaveLength(1);

        state.currentSearchMatchIndex = 0;
        expect(fired).toBe(2);
        state.currentSearchMatchIndex = 0; // тот же индекс — молчит
        expect(fired).toBe(2);
        expect(state.currentSearchMatchIndex).toBe(0);
    });

    it("dispose снимает подписку", () => {
        const state = createState();
        let fired = 0;
        const subscription = state.onDidChangeView(() => fired++);

        state.scrollTop = 1;
        expect(fired).toBe(1);

        subscription.dispose();
        subscription.dispose(); // повторный dispose — no-op
        state.scrollTop = 4;
        expect(fired).toBe(1);
    });
});
