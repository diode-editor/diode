import { describe, expect, it } from "vitest";

import { QUICK_SUGGESTIONS_DEFAULT, readQuickSuggestions, shouldAutoTrigger, valueFor } from "./quickSuggestions.ts";

describe("readQuickSuggestions — upstream validate", () => {
    it("upstream default: code — offWhenInlineCompletions, comments and strings — off", () => {
        expect(QUICK_SUGGESTIONS_DEFAULT).toEqual({
            other: "offWhenInlineCompletions",
            comments: "off",
            strings: "off",
        });
    });

    it("a boolean turns all kinds on/off", () => {
        expect(readQuickSuggestions(true)).toEqual({ other: "on", comments: "on", strings: "on" });
        expect(readQuickSuggestions(false)).toEqual({ other: "off", comments: "off", strings: "off" });
    });

    it("a string is one mode for all kinds; an unknown string is the `other` default", () => {
        expect(readQuickSuggestions("inline")).toEqual({ other: "inline", comments: "inline", strings: "inline" });
        expect(readQuickSuggestions("bogus")).toEqual({
            other: "offWhenInlineCompletions",
            comments: "offWhenInlineCompletions",
            strings: "offWhenInlineCompletions",
        });
    });

    it("an object is read per field: booleans and modes; missing and garbage fields get the field default", () => {
        expect(readQuickSuggestions({ strings: true })).toEqual({
            other: "offWhenInlineCompletions",
            comments: "off",
            strings: "on",
        });
        expect(readQuickSuggestions({ other: false, comments: "on", strings: 42 })).toEqual({
            other: "off",
            comments: "on",
            strings: "off",
        });
    });

    it("a non-object and null give the default", () => {
        expect(readQuickSuggestions(null)).toBe(QUICK_SUGGESTIONS_DEFAULT);
        expect(readQuickSuggestions(7)).toBe(QUICK_SUGGESTIONS_DEFAULT);
        expect(readQuickSuggestions(undefined)).toBe(QUICK_SUGGESTIONS_DEFAULT);
    });

    it("valueFor takes the mode of its kind", () => {
        const config = { other: "on", comments: "inline", strings: "off" } as const;
        expect(valueFor(config, "other")).toBe("on");
        expect(valueFor(config, "comment")).toBe("inline");
        expect(valueFor(config, "string")).toBe("off");
    });
});

describe("shouldAutoTrigger — upstream LineContext.shouldAutoTrigger", () => {
    it("cursor at the end of a word — yes", () => {
        expect(shouldAutoTrigger("const fo", 8)).toBe(true);
        expect(shouldAutoTrigger("x", 1)).toBe(true);
        expect(shouldAutoTrigger("\u043f\u0440\u0438\u0432\u0435\u0442", 6)).toBe(true); // "privet": a non-ASCII word
    });

    it("not on a word: space, paren, dot, hyphen — no", () => {
        expect(shouldAutoTrigger("foo ", 4)).toBe(false);
        expect(shouldAutoTrigger("foo(", 4)).toBe(false);
        expect(shouldAutoTrigger("foo.", 4)).toBe(false);
        expect(shouldAutoTrigger("a -", 3)).toBe(false);
        expect(shouldAutoTrigger("", 0)).toBe(false);
    });

    it("numbers — no", () => {
        expect(shouldAutoTrigger("x = 42", 6)).toBe(false);
        expect(shouldAutoTrigger("x = 1.5", 7)).toBe(false);
        expect(shouldAutoTrigger("x = 4a", 6)).toBe(true);
    });

    it("cursor inside a word — no, but right after its first character — yes", () => {
        // Typed `x` before the word `foo`: the word is `xfoo`, the cursor past its first character.
        expect(shouldAutoTrigger("xfoo", 1)).toBe(true);
        expect(shouldAutoTrigger("xfoo", 2)).toBe(false);
        expect(shouldAutoTrigger("a xfoo", 3)).toBe(true);
        expect(shouldAutoTrigger("a xfoo", 4)).toBe(false);
    });
});
