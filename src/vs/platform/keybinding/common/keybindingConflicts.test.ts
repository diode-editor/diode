import { describe, expect, it } from "vitest";

import { findConflictingBindings, whenMayOverlap } from "./keybindingConflicts.ts";
import type { IKeybindingEntrySnapshot } from "./keybindingRegistry.ts";
import { parseChord } from "./keybindingRegistry.ts";

function entry(spec: string, commandId: string, when?: string): IKeybindingEntrySnapshot {
    return { chord: parseChord(spec), commandId, when, source: "default" };
}

describe("whenMayOverlap", () => {
    it("a missing when overlaps any", () => {
        expect(whenMayOverlap(undefined, undefined)).toBe(true);
        expect(whenMayOverlap(undefined, "textViewFocus")).toBe(true);
        expect(whenMayOverlap("textViewFocus", undefined)).toBe(true);
    });

    it("non-empty whens compare as normalized strings; both sides are trimmed", () => {
        expect(whenMayOverlap("textViewFocus", "textViewFocus ")).toBe(true);
        // A leading space is normalized too (otherwise a.trim() goes untested).
        expect(whenMayOverlap("  textViewFocus", "textViewFocus")).toBe(true);
        expect(whenMayOverlap("textViewFocus", "listFocus")).toBe(false);
        expect(whenMayOverlap("b && a", "(a) && b")).toBe(true);
        expect(whenMayOverlap("a == 'x'", "a == x")).toBe(true);
        expect(whenMayOverlap("a && b", "a || b")).toBe(false);
        expect(whenMayOverlap("a = b ", " a = b")).toBe(true);
        expect(whenMayOverlap("a = b", "a = c")).toBe(false);
    });
});

describe("findConflictingBindings", () => {
    it("two entries for the same keybinding without when conflict", () => {
        const entries = [entry("ctrl+s", "save"), entry("ctrl+s", "other"), entry("ctrl+p", "palette")];

        expect(findConflictingBindings(entries)).toEqual(new Set([0, 1]));
    });

    it("the same chord with different whens is not a conflict", () => {
        const entries = [entry("f6", "a", "textViewFocus"), entry("f6", "b", "listFocus")];

        expect(findConflictingBindings(entries)).toEqual(new Set());
    });

    it("when vs no when is a conflict (a global binding shadows a contextual one)", () => {
        const entries = [entry("f6", "a", "textViewFocus"), entry("f6", "b")];

        expect(findConflictingBindings(entries)).toEqual(new Set([0, 1]));
    });

    it("a chord prefix is not a conflict: ctrl+k vs ctrl+k ctrl+s", () => {
        const entries = [entry("ctrl+k", "a"), entry("ctrl+k ctrl+s", "b")];

        expect(findConflictingBindings(entries)).toEqual(new Set());
    });

    it("an equivalent keybinding spelling is caught via serializeChord canonicalization", () => {
        const entries = [entry("Ctrl+S", "a"), entry("ctrl+s", "b")];

        expect(findConflictingBindings(entries)).toEqual(new Set([0, 1]));
    });

    it("in a triple only overlapping pairs conflict", () => {
        const entries = [
            entry("f6", "a", "textViewFocus"),
            entry("f6", "b", "listFocus"),
            entry("f6", "c", "textViewFocus"),
        ];

        expect(findConflictingBindings(entries)).toEqual(new Set([0, 2]));
    });
});
