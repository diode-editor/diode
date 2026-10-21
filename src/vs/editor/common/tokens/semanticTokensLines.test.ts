import { describe, expect, it } from "vitest";

import { createRange } from "../core/iRange.ts";
import type { ISemanticTokensLegend } from "../languages/iSemanticTokensSource.ts";

import { countEOL, decodeSemanticTokens, SemanticTokensLines } from "./semanticTokensLines.ts";

const LEGEND: ISemanticTokensLegend = { tokenTypes: ["a", "b"], tokenModifiers: ["m"] };
const OTHER: ISemanticTokensLegend = { tokenTypes: ["x"], tokenModifiers: [] };

/** Type 1, modifiers 2. */
function linesOf(spec: Record<number, readonly (readonly [number, number])[]>, legend = LEGEND): SemanticTokensLines {
    const lines = new SemanticTokensLines();
    for (const [line, tokens] of Object.entries(spec)) {
        const entry = lines.ensureLine(Number(line), legend);
        for (const [start, end] of tokens) entry.tokens.push(start, end, 1, 2);
    }
    return lines;
}

function dump(lines: SemanticTokensLines): Record<number, number[][]> {
    const result: Record<number, number[][]> = {};
    for (const line of lines.lineNumbers) {
        const tokens = lines.getLine(line)?.tokens ?? [];
        const pairs: number[][] = [];
        for (let i = 0; i < tokens.length; i += 4) pairs.push([tokens[i], tokens[i + 1]]);
        result[line] = pairs;
    }
    return result;
}

function edit(
    lines: SemanticTokensLines,
    startLine: number,
    startChar: number,
    endLine: number,
    endChar: number,
    text: string,
): Record<number, number[][]> {
    lines.applyEdit(createRange(startLine, startChar, endLine, endChar), text);
    return dump(lines);
}

describe("countEOL", () => {
    it("only \\n is a line break; \\r stays a line character", () => {
        expect(countEOL("")).toEqual([0, 0, 0]);
        expect(countEOL("abc")).toEqual([0, 3, 3]);
        expect(countEOL("ab\ncd\nefg")).toEqual([2, 2, 3]);
        expect(countEOL("a\r\nb")).toEqual([1, 2, 1]);
        expect(countEOL("a\rb")).toEqual([0, 3, 3]);
        expect(countEOL("\n")).toEqual([1, 0, 0]);
    });
});

describe("decodeSemanticTokens", () => {
    it("line and char deltas -> absolute per-line tokens with type and modifiers", () => {
        const lines = decodeSemanticTokens(new Uint32Array([0, 1, 2, 3, 4, 0, 3, 1, 5, 6, 2, 4, 3, 7, 8]), LEGEND);
        expect(lines.lineNumbers).toEqual([0, 2]);
        expect(lines.getLine(0)).toEqual({ legend: LEGEND, tokens: [1, 3, 3, 4, 4, 5, 5, 6] });
        expect(lines.getLine(2)?.tokens).toEqual([4, 7, 7, 8]);
        expect(lines.getLine(0)?.legend).toBe(LEGEND);
        expect(lines.getLine(1)).toBeUndefined();
    });

    it("zero length and overlapping the previous token are dropped; adjacent is not", () => {
        const lines = decodeSemanticTokens(
            new Uint32Array([0, 0, 4, 1, 0, 0, 2, 3, 1, 0, 0, 2, 0, 1, 0, 0, 2, 1, 1, 0]),
            LEGEND,
        );
        // [0,4]; [2,5] overlaps; [4,4] is zero-length; [6,7] after [4,4] (delta from the dropped one), not adjacent.
        expect(lines.getLine(0)?.tokens).toEqual([0, 4, 1, 0, 6, 7, 1, 0]);
    });

    it("dropped token that opened a line does not move the next tokens to the previous line", () => {
        const lines = decodeSemanticTokens(new Uint32Array([0, 0, 2, 1, 0, 1, 0, 0, 1, 0, 0, 3, 2, 1, 0]), LEGEND);
        expect(dump(lines)).toEqual({ 0: [[0, 2]], 1: [[3, 5]] });
    });

    it("incomplete last quintuple is ignored", () => {
        const lines = decodeSemanticTokens(new Uint32Array([0, 0, 2, 1, 0, 0, 3, 1, 1]), LEGEND);
        expect(lines.getLine(0)?.tokens).toEqual([0, 2, 1, 0]);
        expect(decodeSemanticTokens(new Uint32Array([]), LEGEND).lineNumbers).toEqual([]);
    });
});

describe("SemanticTokensLines: reading and replacing lines", () => {
    it("line without tokens is undefined", () => {
        const lines = new SemanticTokensLines();
        lines.ensureLine(3, LEGEND);
        expect(lines.getLine(3)).toBeUndefined();
        expect(lines.lineNumbers).toEqual([]);
    });

    it("ensureLine returns the existing line without replacing the legend", () => {
        const lines = new SemanticTokensLines();
        const first = lines.ensureLine(0, LEGEND);
        expect(lines.ensureLine(0, OTHER)).toBe(first);
        expect(first.legend).toBe(LEGEND);
    });

    it("replaceLines: range lines are copied from the source, those without tokens in the source are cleared", () => {
        const target = linesOf({ 0: [[0, 1]], 1: [[0, 1]], 2: [[0, 1]], 3: [[0, 1]] });
        const source = linesOf({ 1: [[5, 6]], 3: [[7, 8]] }, OTHER);
        target.replaceLines(1, 2, source);
        expect(dump(target)).toEqual({ 0: [[0, 1]], 1: [[5, 6]], 3: [[0, 1]] });
        expect(target.getLine(1)?.legend).toBe(OTHER);
        source.applyEdit(createRange(1, 0, 1, 0), "zz");
        expect(dump(target)[1]).toEqual([[5, 6]]);
    });

    it("replaceLines past the end of known lines puts the source lines", () => {
        const target = linesOf({ 0: [[0, 1]] });
        target.replaceLines(4, 6, linesOf({ 5: [[1, 2]] }));
        expect(dump(target)).toEqual({ 0: [[0, 1]], 5: [[1, 2]] });
    });
});

describe("SemanticTokensLines: delete within one line (upstream cases)", () => {
    const token = (): SemanticTokensLines => linesOf({ 0: [[5, 10]] });

    it("empty range deletes nothing", () => {
        expect(edit(token(), 0, 7, 0, 7, "")).toEqual({ 0: [[5, 10]] });
    });
    it("1a. token entirely before the deletion", () => {
        expect(edit(token(), 0, 10, 0, 12, "")).toEqual({ 0: [[5, 10]] });
    });
    it("1b. starts earlier, deletion ends after the token: trimmed to the deletion start", () => {
        expect(edit(token(), 0, 8, 0, 12, "")).toEqual({ 0: [[5, 8]] });
    });
    it("1c. deletion ends exactly at the token end", () => {
        expect(edit(token(), 0, 8, 0, 10, "")).toEqual({ 0: [[5, 8]] });
    });
    it("1d. deletion inside the token: token shrinks by the deleted part", () => {
        expect(edit(token(), 0, 6, 0, 8, "")).toEqual({ 0: [[5, 8]] });
    });
    it("2a/2b. same start, end inside or exactly at the deletion end: token removed", () => {
        expect(edit(token(), 0, 5, 0, 12, "")).toEqual({});
        expect(edit(token(), 0, 5, 0, 10, "")).toEqual({});
    });
    it("2c. same start, token longer than the deletion: shrinks", () => {
        expect(edit(token(), 0, 5, 0, 7, "")).toEqual({ 0: [[5, 8]] });
    });
    it("3a/3b. token inside the deletion: removed", () => {
        expect(edit(token(), 0, 3, 0, 12, "")).toEqual({});
        expect(edit(token(), 0, 3, 0, 10, "")).toEqual({});
    });
    it("3c. starts inside the deletion, ends after: continues from its start", () => {
        expect(edit(token(), 0, 3, 0, 7, "")).toEqual({ 0: [[3, 6]] });
    });
    it("4. token after the deletion: shifts left", () => {
        expect(edit(token(), 0, 1, 0, 3, "")).toEqual({ 0: [[3, 8]] });
    });
    it("leaves other lines alone", () => {
        expect(edit(linesOf({ 0: [[5, 10]], 1: [[1, 2]] }), 0, 1, 0, 3, "")).toEqual({ 0: [[3, 8]], 1: [[1, 2]] });
    });
    it("token type and modifiers survive the edit", () => {
        const lines = token();
        lines.applyEdit(createRange(0, 1, 0, 3), "");
        expect(lines.getLine(0)?.tokens).toEqual([3, 8, 1, 2]);
    });
    it("each token keeps its own type and modifiers in all deletion branches", () => {
        const single = new SemanticTokensLines();
        single.ensureLine(0, LEGEND).tokens.push(0, 2, 3, 4, 5, 10, 1, 6);
        single.applyEdit(createRange(0, 5, 0, 7), ""); // 2c
        expect(single.getLine(0)?.tokens).toEqual([0, 2, 3, 4, 5, 8, 1, 6]);

        const multi = new SemanticTokensLines();
        multi.ensureLine(0, LEGEND).tokens.push(0, 1, 3, 4);
        multi.ensureLine(1, LEGEND).tokens.push(0, 1, 5, 6, 2, 4, 7, 8, 5, 7, 9, 10);
        multi.applyEdit(createRange(0, 2, 1, 3), ""); // 1a, 3b, 3c, 4 on the last line
        expect(multi.getLine(0)?.tokens).toEqual([0, 1, 3, 4, 2, 3, 7, 8, 4, 6, 9, 10]);
    });
});

describe("SemanticTokensLines: multiline delete", () => {
    it("first line: before stays, at the edge is trimmed, after is removed; middle lines go; last line is pulled up", () => {
        const lines = linesOf({
            0: [
                [0, 2],
                [3, 6],
                [7, 9],
            ],
            1: [[0, 3]],
            2: [
                [1, 3],
                [2, 6],
                [7, 9],
            ],
            3: [[1, 2]],
        });
        // (0,5)..(2,4): [2,6] on the last one — 3c → [5,7]; [7,9] — 4 → [8,10]; [1,3] — 3a.
        expect(edit(lines, 0, 5, 2, 4, "")).toEqual({
            0: [
                [0, 2],
                [3, 5],
                [5, 7],
                [8, 10],
            ],
            1: [[1, 2]],
        });
    });

    it("on the first line a token exactly at the deletion start is removed (2a/2b)", () => {
        // Line 1 merges into line zero: its token moves past the join point.
        expect(edit(linesOf({ 0: [[5, 9]], 1: [[0, 1]] }), 0, 5, 1, 0, "")).toEqual({ 0: [[5, 6]] });
    });

    it("on the last line a token ending exactly at the deletion end is removed (3b)", () => {
        expect(edit(linesOf({ 0: [[0, 1]], 1: [[0, 4]] }), 0, 2, 1, 4, "")).toEqual({ 0: [[0, 1]] });
    });

    it("first line without tokens takes the legend of the last", () => {
        const lines = linesOf({ 1: [[6, 8]] }, OTHER);
        expect(edit(lines, 0, 2, 1, 4, "")).toEqual({ 0: [[4, 6]] });
        expect(lines.getLine(0)?.legend).toBe(OTHER);
    });

    it("first line without tokens: 3c of the last line moves to the deletion start", () => {
        const lines = linesOf({ 1: [[0, 4]] });
        expect(edit(lines, 0, 2, 1, 1, "")).toEqual({ 0: [[2, 5]] });
        expect(lines.getLine(0)?.legend).toBe(LEGEND);
    });

    it("multiline delete with equal columns is still a delete", () => {
        const lines = linesOf({
            0: [
                [0, 1],
                [3, 5],
            ],
            1: [
                [0, 1],
                [3, 5],
            ],
        });
        expect(edit(lines, 0, 2, 1, 2, "")).toEqual({
            0: [
                [0, 1],
                [3, 5],
            ],
        });
    });

    it("delete starting below the first line: exactly the range lines go", () => {
        const lines = linesOf({ 0: [[0, 1]], 3: [[0, 2]], 4: [[1, 2]], 5: [[2, 3]] });
        expect(edit(lines, 2, 0, 3, 1, "")).toEqual({ 0: [[0, 1]], 2: [[0, 1]], 3: [[1, 2]], 4: [[2, 3]] });
    });

    it("delete over lines without tokens leaves no line without a legend", () => {
        const lines = linesOf({ 3: [[0, 1]] });
        lines.applyEdit(createRange(0, 1, 1, 0), "");
        expect(lines.ensureLine(0, OTHER).legend).toBe(OTHER);
    });

    it("last line tokens with a different legend are dropped", () => {
        const lines = linesOf({ 0: [[0, 1]] });
        lines.ensureLine(1, OTHER).tokens.push(0, 6, 0, 0, 7, 9, 0, 0);
        expect(edit(lines, 0, 2, 1, 4, "")).toEqual({ 0: [[0, 1]] });
    });

    it("everything deleted: line is empty, lines below are pulled up", () => {
        const lines = linesOf({ 0: [[2, 3]], 1: [[0, 1]], 3: [[4, 5]] });
        expect(edit(lines, 0, 1, 1, 9, "")).toEqual({ 2: [[4, 5]] });
    });

    it("delete past the end of known lines creates nothing", () => {
        const lines = linesOf({ 0: [[2, 3]] });
        expect(edit(lines, 5, 0, 7, 1, "")).toEqual({ 0: [[2, 3]] });
        lines.applyEdit(createRange(9, 0, 9, 1), "");
        expect(dump(lines)).toEqual({ 0: [[2, 3]] });
    });
});

describe("SemanticTokensLines: insert (upstream cases)", () => {
    const token = (): SemanticTokensLines => linesOf({ 0: [[5, 10]] });

    it("1. token entirely before the insert point", () => {
        expect(edit(token(), 0, 12, 0, 12, "ab")).toEqual({ 0: [[5, 10]] });
    });

    it("2. token ends at the insert point: grows only by a single word character", () => {
        for (const ch of ["a", "z", "A", "Z", "0", "9", "m"]) {
            expect(edit(token(), 0, 10, 0, 10, ch), ch).toEqual({ 0: [[5, 11]] });
        }
        for (const ch of ["/", ":", "@", "[", "`", "{", "-", " ", "ab"]) {
            expect(edit(token(), 0, 10, 0, 10, ch), ch).toEqual({ 0: [[5, 10]] });
        }
    });

    it("3. insert point inside the token: grows by the insert, a line break trims it", () => {
        expect(edit(token(), 0, 7, 0, 7, "abc")).toEqual({ 0: [[5, 13]] });
        expect(edit(token(), 0, 7, 0, 7, "x\nyz")).toEqual({ 0: [[5, 7]] });
    });

    it("4. token starts at the insert point: a single word character keeps it, otherwise it shifts", () => {
        expect(edit(token(), 0, 5, 0, 5, "a")).toEqual({ 0: [[5, 10]] });
        expect(edit(token(), 0, 5, 0, 5, "-")).toEqual({ 0: [[6, 11]] });
        expect(edit(token(), 0, 5, 0, 5, "ab")).toEqual({ 0: [[7, 12]] });
    });

    it("word character with a line break is not 'exactly one character': token does not grow", () => {
        expect(edit(token(), 0, 10, 0, 10, "a\nb")).toEqual({ 0: [[5, 10]] });
    });

    it("5. token after the insert point: shifts right", () => {
        expect(edit(token(), 0, 2, 0, 2, "ab")).toEqual({ 0: [[7, 12]] });
    });

    it("multiline insert moves tokens to the right onto the last new line by its length", () => {
        const lines = linesOf({
            0: [
                [0, 1],
                [5, 10],
            ],
            1: [[3, 4]],
        });
        expect(edit(lines, 0, 2, 0, 2, "x\nyz")).toEqual({ 0: [[0, 1]], 1: [[5, 10]], 2: [[3, 4]] });
        const deep = linesOf({ 0: [[5, 10]], 2: [[1, 2]] });
        expect(edit(deep, 0, 2, 0, 2, "a\nb\nccc")).toEqual({ 2: [[6, 11]], 4: [[1, 2]] });
        expect(deep.getLine(2)?.legend).toBe(LEGEND);
    });

    it("line break above tokens shifts lines below; on a line without tokens too", () => {
        expect(edit(linesOf({ 1: [[0, 2]], 3: [[1, 2]] }), 0, 0, 0, 0, "\n\n")).toEqual({
            3: [[0, 2]],
            5: [[1, 2]],
        });
    });

    it("insert past the end of known lines creates nothing", () => {
        expect(edit(linesOf({ 0: [[0, 2]] }), 4, 0, 4, 0, "a\nb")).toEqual({ 0: [[0, 2]] });
    });

    it("replace: delete and insert in one edit", () => {
        // [5,10] with replacement (1..3) → "abcd": shift -2, then +4.
        expect(edit(token(), 0, 1, 0, 3, "abcd")).toEqual({ 0: [[7, 12]] });
    });

    it("insert into a line without tokens and without line breaks changes nothing", () => {
        expect(edit(linesOf({ 1: [[0, 2]] }), 0, 0, 0, 0, "abc")).toEqual({ 1: [[0, 2]] });
    });
});
