import { describe, expect, it } from "vitest";
import { INITIAL } from "vscode-textmate";

import { TextMateState } from "./textMateState.ts";

describe("TextMateState", () => {
    it("clone() returns a new TextMateState wrapping a cloned stack", () => {
        const state = new TextMateState(INITIAL);
        const cloned = state.clone();

        expect(cloned).not.toBe(state);
        expect(cloned).toBeInstanceOf(TextMateState);
        // …but equal in content (StateStack is immutable, so its clone() is self).
        expect(cloned.equals(state)).toBe(true);
        expect(state.equals(cloned)).toBe(true);
    });

    it("equals() is true for two wrappers over the same stack", () => {
        const a = new TextMateState(INITIAL);
        const b = new TextMateState(INITIAL);
        expect(a.equals(b)).toBe(true);
    });

    it("equals() is false against a non-TextMateState state", () => {
        const state = new TextMateState(INITIAL);
        const foreign = { clone: () => foreign, equals: () => true };
        expect(state.equals(foreign)).toBe(false);
    });

    it("exposes the wrapped stack", () => {
        const state = new TextMateState(INITIAL);
        expect(state.stack).toBe(INITIAL);
    });
});
