import { describe, expect, it } from "vitest";

import { FileDecoration, ThemeColor, ThemeIcon } from "./vscodeTypes.ts";

/** Upstream `FileDecoration.validate` (extHostTypes.ts): a badge is at most two graphemes; an empty decoration throws. */
describe("FileDecoration.validate", () => {
    it.each([
        ["one letter", "M"],
        ["two digits", "10"],
        ["one emoji (a surrogate pair)", "🙂"],
        ["two emoji", "🙂🙂"],
        ["an emoji with a skin tone modifier", "👍🏽"],
        ["a letter with a combining accent and another letter", "éx"],
    ])("accepts %s", (_, badge) => {
        expect(FileDecoration.validate(new FileDecoration(badge))).toBe(true);
    });

    it.each([
        ["three letters", "ABC"],
        ["three emoji", "🙂🙂🙂"],
    ])("rejects %s", (_, badge) => {
        expect(() => FileDecoration.validate(new FileDecoration(badge))).toThrow();
    });

    it("rejects a decoration with nothing in it", () => {
        expect(() => FileDecoration.validate(new FileDecoration())).toThrow();
    });

    it("accepts a decoration with only a color or only a tooltip", () => {
        expect(FileDecoration.validate(new FileDecoration(undefined, undefined, new ThemeColor("charts.red")))).toBe(
            true,
        );
        expect(FileDecoration.validate(new FileDecoration(undefined, "tip"))).toBe(true);
    });

    it("rejects a codicon badge (proposed API, not supported)", () => {
        const decoration = new FileDecoration();
        (decoration as { badge?: unknown }).badge = new ThemeIcon("check");
        expect(() => FileDecoration.validate(decoration)).toThrow();
    });
});
