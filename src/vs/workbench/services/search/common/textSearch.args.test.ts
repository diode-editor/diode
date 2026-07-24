import { describe, expect, it } from "vitest";

import { buildRgArgs, validateRegex, type ITextSearchQuery } from "./textSearch.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function query(overrides: Partial<ITextSearchQuery> = {}): ITextSearchQuery {
    return {
        pattern: "foo",
        isRegExp: false,
        isCaseSensitive: false,
        isWholeWord: false,
        includes: [],
        excludes: [],
        ...overrides,
    };
}

const ROOT = "/work/project";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("buildRgArgs", () => {
    it("returns null for an empty pattern", () => {
        expect(buildRgArgs(query({ pattern: "" }), ROOT)).toBeNull();
    });

    it("returns null for a malformed regex when the regex toggle is on", () => {
        expect(buildRgArgs(query({ pattern: "(", isRegExp: true }), ROOT)).toBeNull();
    });

    it("does not reject a malformed pattern when the regex toggle is off", () => {
        // "(" is a valid literal (fixed) string, so it must still search.
        expect(buildRgArgs(query({ pattern: "(" }), ROOT)).not.toBeNull();
    });

    it("always requests JSON output and terminates with the search path", () => {
        const args = buildRgArgs(query(), ROOT)!;
        expect(args[0]).toBe("--json");
        expect(args.slice(-2)).toEqual(["--", ROOT]);
    });

    it("passes the pattern via -e so a leading dash is not a flag", () => {
        const args = buildRgArgs(query({ pattern: "-foo" }), ROOT)!;
        const i = args.indexOf("-e");
        expect(i).toBeGreaterThanOrEqual(0);
        expect(args[i + 1]).toBe("-foo");
    });

    // ── Case sensitivity ────────────────────────────────────────────────────────

    it("uses --ignore-case when case sensitivity is off", () => {
        expect(buildRgArgs(query({ isCaseSensitive: false }), ROOT)).toContain("--ignore-case");
    });

    it("uses --case-sensitive when case sensitivity is on", () => {
        const args = buildRgArgs(query({ isCaseSensitive: true }), ROOT)!;
        expect(args).toContain("--case-sensitive");
        expect(args).not.toContain("--ignore-case");
    });

    // ── Whole word ──────────────────────────────────────────────────────────────

    it("adds --word-regexp only when whole-word is on", () => {
        expect(buildRgArgs(query({ isWholeWord: false }), ROOT)).not.toContain("--word-regexp");
        expect(buildRgArgs(query({ isWholeWord: true }), ROOT)).toContain("--word-regexp");
    });

    // ── Literal vs regex ──────────────────────────────────────────────────────────

    it("adds --fixed-strings for a literal query", () => {
        expect(buildRgArgs(query({ isRegExp: false }), ROOT)).toContain("--fixed-strings");
    });

    it("omits --fixed-strings for a regex query", () => {
        expect(buildRgArgs(query({ pattern: "fo+", isRegExp: true }), ROOT)).not.toContain("--fixed-strings");
    });

    // ── Include / exclude globs ───────────────────────────────────────────────────

    it("maps includes to --glob and excludes to negated --glob", () => {
        const args = buildRgArgs(query({ includes: ["*.ts", "*.js"], excludes: ["dist"] }), ROOT)!;
        expect(args).toContain("*.ts");
        expect(args).toContain("*.js");
        expect(args).toContain("!dist");
        // one --glob per include + exclude
        expect(args.filter((a) => a === "--glob")).toHaveLength(3);
    });

    it("ignores empty glob entries", () => {
        const args = buildRgArgs(query({ includes: [""], excludes: [""] }), ROOT)!;
        expect(args).not.toContain("--glob");
    });
});

describe("validateRegex", () => {
    it("returns null for a valid pattern", () => {
        expect(validateRegex("fo+bar")).toBeNull();
    });

    it("returns a message for a malformed pattern", () => {
        expect(validateRegex("(")).not.toBeNull();
    });
});
