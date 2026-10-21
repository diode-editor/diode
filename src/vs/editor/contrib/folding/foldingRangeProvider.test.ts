import { describe, expect, it } from "vitest";

import { TextDocument } from "../../common/model/textDocument.ts";

import { computeIndentationFolds, computeIndentLevel } from "./foldingRangeProvider.ts";

function folds(text: string, tabSize = 4): { startLine: number; endLine: number }[] {
    return computeIndentationFolds(new TextDocument(text), tabSize).map((r) => ({
        startLine: r.startLine,
        endLine: r.endLine,
    }));
}

describe("computeIndentLevel", () => {
    it("counts leading spaces", () => {
        expect(computeIndentLevel("    x", 4)).toBe(4);
    });

    it("expands tabs to the next tab stop", () => {
        expect(computeIndentLevel("\tx", 4)).toBe(4);
        expect(computeIndentLevel("\t\tx", 4)).toBe(8);
        expect(computeIndentLevel(" \tx", 4)).toBe(4); // 1 space then tab → still 4
    });

    it("returns -1 for empty and whitespace-only lines", () => {
        expect(computeIndentLevel("", 4)).toBe(-1);
        expect(computeIndentLevel("   ", 4)).toBe(-1);
        expect(computeIndentLevel("\t", 4)).toBe(-1);
    });

    it("returns 0 for an unindented content line", () => {
        expect(computeIndentLevel("x", 4)).toBe(0);
    });
});

describe("computeIndentationFolds", () => {
    it("returns no regions for a flat document", () => {
        expect(folds("a\nb\nc")).toEqual([]);
    });

    it("detects a single indented block", () => {
        expect(folds("f() {\n  a\n  b\n}")).toEqual([{ startLine: 0, endLine: 2 }]);
    });

    it("does not create a region for a single indented line", () => {
        // header + one indented line hides exactly one line → valid region
        expect(folds("f\n  a")).toEqual([{ startLine: 0, endLine: 1 }]);
    });

    it("ignores a header with no deeper lines", () => {
        expect(folds("a\nb")).toEqual([]);
    });

    it("detects nested regions", () => {
        expect(folds("a:\n  b:\n    c\n  d")).toEqual([
            { startLine: 0, endLine: 3 },
            { startLine: 1, endLine: 2 },
        ]);
    });

    it("attaches trailing blank lines to the enclosing region", () => {
        expect(folds("a:\n  b\n\nc")).toEqual([{ startLine: 0, endLine: 2 }]);
    });

    it("closes a region when indentation returns to the header level", () => {
        expect(folds("a:\n  b\nc:\n  d")).toEqual([
            { startLine: 0, endLine: 1 },
            { startLine: 2, endLine: 3 },
        ]);
    });

    it("honours tab size when comparing indentation", () => {
        expect(folds("f\n\ta\n\tb")).toEqual([{ startLine: 0, endLine: 2 }]);
    });
});
