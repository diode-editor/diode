import { describe, expect, it } from "vitest";

import { positionsEqual } from "../../../common/core/iPosition.ts";
import { createRange, type IRange } from "../../../common/core/iRange.ts";
import { TextDocument } from "../../../common/model/textDocument.ts";

import { createSnippetInsert, type ISnippetInsertOptions } from "./snippetSession.ts";

const SPACES: ISnippetInsertOptions = { adjustWhitespace: true, tabSize: 4, insertSpaces: true };

const at = (line: number, character: number): IRange => createRange(line, character, line, character);

/** Applies the insert and draws each selection: `[` anchor, `]` active, `|` a caret. */
function insert(
    text: string,
    ranges: readonly IRange[],
    template: string,
    options: ISnippetInsertOptions = SPACES,
): string {
    const document = new TextDocument(text);
    const result = createSnippetInsert(
        document,
        ranges.map((range) => ({ range, template })),
        options,
    );
    document.applyEdits(result.edits);
    const lines = document.getText().split("\n");
    const marks = result.selections.flatMap(({ anchor, active }) =>
        positionsEqual(anchor, active)
            ? [{ ...active, mark: "|" }]
            : [
                  { ...anchor, mark: "[" },
                  { ...active, mark: "]" },
              ],
    );
    marks
        .sort((a, b) => b.line - a.line || b.character - a.character)
        .forEach(({ line, character, mark }) => {
            lines[line] = lines[line].slice(0, character) + mark + lines[line].slice(character);
        });
    return lines.join("\n");
}

describe("createSnippetInsert: text and first caret", () => {
    it("text without tab stops leaves the caret at its end", () => {
        expect(insert("ab", [at(0, 1)], "xy")).toBe("axy|b");
    });

    it("selects the first placeholder; `$0` comes last whatever its place", () => {
        expect(insert("", [at(0, 0)], "a$0b${2:two}c${1:one}")).toBe("abtwoc[one]");
    });

    it("only `$0` puts the caret on it", () => {
        expect(insert("", [at(0, 0)], "a$0b")).toBe("a|b");
    });

    it("a nested placeholder of any depth: the outer one is selected whole", () => {
        expect(insert("", [at(0, 0)], "${1:${2:${3:deep} inner} outer}!")).toBe("[deep inner outer]!");
    });

    it("a mirror without text takes its placeholder's text, and both are selected", () => {
        expect(insert("", [at(0, 0)], "$1 = ${1:x}")).toBe("[x] = [x]");
    });

    it("a choice inserts its first option, selected", () => {
        expect(insert("", [at(0, 0)], "${1|a\\,b,c|}")).toBe("[a,b]");
    });

    it("escapes are text, and an unclosed placeholder stays literal", () => {
        expect(insert("", [at(0, 0)], "\\$1 \\} \\\\ ${1:")).toBe("$1 } \\ ${1:|");
    });

    it("the selection reaches a later line of a multi-line placeholder", () => {
        expect(insert("", [at(0, 0)], "a\n${1:b\nc}")).toBe("a\n[b\nc]");
    });

    it("the first placeholder with text gives a tab stop its text", () => {
        expect(insert("", [at(0, 0)], "${1:a} ${1:b} $1")).toBe("[a] [a] [a]");
    });

    it("an empty template is an empty insert", () => {
        expect(insert("ab", [at(0, 1)], "")).toBe("a|b");
    });

    it("replaces the range it is given", () => {
        expect(insert("abcdef", [createRange(0, 1, 0, 4)], "${1:X}")).toBe("a[X]ef");
    });
});

describe("createSnippetInsert: whitespace (upstream adjustWhitespace)", () => {
    it("further lines get the line's indentation, normalized to the tab settings", () => {
        expect(insert("    x", [at(0, 5)], "if\n\t$0foo")).toBe("    xif\n        |foo");
    });

    it("the snippet start is only normalized", () => {
        expect(insert("  ", [at(0, 2)], "\tA")).toBe("      A|");
    });

    it("a tab counts up to the next tab stop column", () => {
        expect(insert("", [at(0, 0)], "\n  \tx")).toBe("\n    x|");
    });

    it("the line's indentation counts only up to the insert position", () => {
        expect(insert("    abcd", [at(0, 2)], "x\ny")).toBe("  x\n  y|  abcd");
    });

    it("a text after a line break inside a choice is indented too", () => {
        expect(insert("  ", [at(0, 2)], "${1|a\n|}b")).toBe("  [a\n]  b");
        expect(insert("  ", [at(0, 2)], "${1|a\r|}b")).toBe("  [a\n]  b");
    });

    it("a later edit's leading text joins the text between the edits and is not adjusted, as upstream", () => {
        expect(insert("a\nb", [at(0, 1), at(1, 0)], "\tx")).toBe("a    x|\n\tx|b");
    });

    it("tabs when insertSpaces is off", () => {
        expect(insert("    x", [at(0, 5)], "a\n  b", { ...SPACES, insertSpaces: false })).toBe("    xa\n\t  b|");
    });

    it("a text right after a line break in another marker is indented too, outside the placeholder", () => {
        expect(insert("  ", [at(0, 2)], "${1:a\n}b")).toBe("  [a\n]  b");
    });

    it("keepWhitespace inserts the lines as they are", () => {
        expect(insert("    x", [at(0, 5)], "a\n\tb", { ...SPACES, adjustWhitespace: false })).toBe("    xa\n\tb|");
    });

    it("a CRLF in the template becomes the document's line break", () => {
        expect(insert("", [at(0, 0)], "a\r\nb", { ...SPACES, adjustWhitespace: false })).toBe("a\nb|");
    });
});

describe("createSnippetInsert: several ranges", () => {
    it("an edit per range, a caret in each, each indented for its own line", () => {
        expect(insert("x\n  y", [at(1, 3), at(0, 1)], "{\n$0}")).toBe("x{\n|}\n  y{\n|  }");
    });

    it("the same tab stop in every edit is one group, selected in each", () => {
        expect(insert("a b", [at(0, 3), at(0, 1)], "${1:p}$0")).toBe("a[p] b[p]");
    });

    it("without tab stops the caret goes to the end of every edit", () => {
        expect(insert("a\nb", [at(1, 1), at(0, 1)], "-")).toBe("a-|\nb-|");
    });
});

describe("createSnippetInsert: variables", () => {
    it("TM_SELECTED_TEXT is the range's text, transformed", () => {
        expect(insert("abc", [createRange(0, 0, 0, 3)], "${TM_SELECTED_TEXT/(.*)/${1:/upcase}/}")).toBe("ABC|");
    });

    it("snippet syntax in the selected text is text", () => {
        expect(insert("$1}", [createRange(0, 0, 0, 3)], "<$TM_SELECTED_TEXT>")).toBe("<$1}>|");
    });

    it("SELECTION too, and an empty range is no value: the default applies", () => {
        expect(insert("ab", [createRange(0, 0, 0, 1)], "<$SELECTION>")).toBe("<a>|b");
        expect(insert("ab", [at(0, 1)], "${SELECTION:none}")).toBe("anone|b");
    });

    it("a multi-line selection gets the extra indentation the variable has in the snippet", () => {
        expect(insert("  a\n  b", [createRange(0, 2, 1, 3)], "{\n\t$TM_SELECTED_TEXT\n}")).toBe(
            "  {\n    a\n    b\n  }|",
        );
    });

    it("a selection starting inside the indentation, with a placeholder before the variable", () => {
        expect(insert("    a\n    b", [createRange(0, 1, 1, 5)], "$1{\n\t$TM_SELECTED_TEXT\n}")).toBe(
            " |{\n       a\n       b\n }",
        );
    });

    it("a selection on one line is taken as it is", () => {
        expect(insert("\ta\tb", [createRange(0, 1, 0, 4)], "<$TM_SELECTED_TEXT>")).toBe("\t<a\tb>|");
    });

    it("line, word and cursor variables are read at the range's end", () => {
        expect(
            insert(
                "one\nfoo bar",
                [at(1, 5), at(0, 0)],
                "$TM_LINE_INDEX/$TM_LINE_NUMBER/$CURSOR_INDEX/$CURSOR_NUMBER ",
            ),
        ).toBe("0/1/1/2 |one\nfoo b1/2/0/1 |ar");
        expect(insert("foo bar", [at(0, 5)], "[$TM_CURRENT_WORD|$TM_CURRENT_LINE]")).toBe("foo b[bar|foo bar]|ar");
    });

    it("no word at the position: TM_CURRENT_WORD is empty", () => {
        expect(insert("a  b", [at(0, 2)], "<$TM_CURRENT_WORD>")).toBe("a <>| b");
    });

    it("a variable with no resolver yet is its default or empty, as an unknown one", () => {
        expect(insert("", [at(0, 0)], "[$TM_FILENAME|${TM_FILENAME:x}|$FOO|${FOO:y}]")).toBe("[|x||y]|");
    });

    it("a later edit does not resolve the variables of an earlier one again", () => {
        expect(insert("a\nbbb", [at(0, 1), at(1, 3)], "$TM_CURRENT_LINE${1:p}")).toBe("aa[p]\nbbbbbb[p]");
    });

    it("a placeholder backfilled into another edit gets that edit's variables", () => {
        expect(insert("a\nb", [at(0, 1), at(1, 1)], "${1:$TM_LINE_NUMBER}")).toBe("a[1]\nb[2]");
    });
});
