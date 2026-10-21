import { describe, expect, it } from "vitest";

import type { CharacterPair } from "../../../platform/extensions/common/iLanguageConfiguration.ts";
import { createPosition } from "../../common/core/iPosition.ts";
import { TextDocument } from "../../common/model/textDocument.ts";

import { type IsCodeAt, provideBracketSelectionRanges } from "./bracketSelections.ts";

const BRACKETS: readonly CharacterPair[] = [
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
];

function steps(
    text: string,
    line: number,
    character: number,
    brackets: readonly CharacterPair[] = BRACKETS,
    isCodeAt?: IsCodeAt,
): string[] {
    const document = new TextDocument(text);
    const [ranges] = provideBracketSelectionRanges(document, [createPosition(line, character)], brackets, isCodeAt);
    return ranges.map((range) => document.getTextInRange(range));
}

describe("provideBracketSelectionRanges: upstream bracketSelections", () => {
    it("enclosing pairs from the nearest: inside, then the whole pair", () => {
        expect(steps("f(a, [b, c])", 0, 6)).toEqual(["b, c", "[b, c]", "a, [b, c]", "(a, [b, c])"]);
    });

    it("closed pairs along the way are skipped", () => {
        expect(steps("(x(y) z (w) |)", 0, 6)).toEqual(["x(y) z (w) |", "(x(y) z (w) |)"]);
    });

    it("cursor next to a bracket: inside `(|)` the pair is empty, before `|(` it does not enclose", () => {
        expect(steps("()", 0, 1)).toEqual(["", "()"]);
        expect(steps("(a)", 0, 0)).toEqual([]);
        expect(steps("(a)", 0, 3)).toEqual([]);
    });

    it("different bracket kinds do not mix, unmatched ones form no range", () => {
        expect(steps("[ ( ]", 0, 3)).toEqual([" ( ", "[ ( ]"]);
        expect(steps("(a", 0, 1)).toEqual([]);
        expect(steps("a)", 0, 1)).toEqual([]);
    });

    it("multi-line pair: from the header line, without indent and whole", () => {
        const text = "  if (x) {\n    y\n  }";
        expect(steps(text, 1, 4)).toEqual([
            "\n    y\n  ",
            "{\n    y\n  }",
            "if (x) {\n    y\n  }",
            "  if (x) {\n    y\n  }",
        ]);
    });

    it("bracket on its own line under a header of the same column: from the header", () => {
        const text = "fn\n{\n  y\n}";
        expect(steps(text, 2, 2)).toEqual(["\n  y\n", "{\n  y\n}", "fn\n{\n  y\n}", "fn\n{\n  y\n}"]);
        // A header in another column or a blank line above the bracket: no header step.
        expect(steps("  fn\n{\n}", 1, 1)).toEqual(["\n", "{\n}"]);
        expect(steps("\n{\n}", 1, 1)).toEqual(["\n", "{\n}"]);
    });

    it("non-code brackets (strings, comments) form no pair", () => {
        // `f(")")`: the closing bracket inside the string is not the match.
        const inString: IsCodeAt = (_line, character) => character < 2 || character > 4;
        expect(steps('f(")")', 0, 4, BRACKETS, inString)).toEqual(['")"', '(")")']);
        // Without tokens, `)` in the string closes `(`, leaving no enclosing pair for a cursor past it.
        expect(steps('f(")")', 0, 4)).toEqual([]);
    });

    it("multi-char brackets: longest first; a word bracket matches only as a whole word", () => {
        const pairs: readonly CharacterPair[] = [
            ["[", "]"],
            ["[[", "]]"],
            ["begin", "end"],
        ];
        expect(steps("[[ a ]]", 0, 3, pairs)).toEqual([" a ", "[[ a ]]"]);
        expect(steps("begin endless end", 0, 6, pairs)).toEqual([" endless ", "begin endless end"]);
        expect(steps("xbegin a end", 0, 7, pairs)).toEqual([]);
        expect(steps("begin a endx", 0, 6, pairs)).toEqual([]);
    });

    it("no language brackets and degenerate pairs yield nothing", () => {
        expect(steps("(a)", 0, 1, [])).toEqual([]);
        expect(
            steps("|a|", 0, 1, [
                ["|", "|"],
                ["", ")"],
                ["(", ""],
            ]),
        ).toEqual([]);
    });

    it("result is aligned with cursors", () => {
        const document = new TextDocument("(a) [b]");
        const ranges = provideBracketSelectionRanges(document, [createPosition(0, 1), createPosition(0, 5)], BRACKETS);
        expect(ranges.map((one) => one.map((range) => document.getTextInRange(range)))).toEqual([
            ["a", "(a)"],
            ["b", "[b]"],
        ]);
    });
});
