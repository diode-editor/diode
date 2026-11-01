import { describe, expect, it } from "vitest";

import { resolveSnippet } from "./extHostSnippetInsert.ts";

const SPACES_4 = { tabSize: 4, insertSpaces: true };
const TABS_4 = { tabSize: 4, insertSpaces: false };

/** The resolved text with the caret drawn as `|`, or a selection as `[…]`. */
function drawn(template: string, lead = "", indentation: typeof SPACES_4 | null = SPACES_4): string {
    const { text, selectionStart, selectionEnd } = resolveSnippet(template, lead, indentation);
    if (selectionStart === selectionEnd) return `${text.slice(0, selectionStart)}|${text.slice(selectionStart)}`;
    return `${text.slice(0, selectionStart)}[${text.slice(selectionStart, selectionEnd)}]${text.slice(selectionEnd)}`;
}

describe("resolveSnippet", () => {
    it("puts the caret at the end of a snippet without tab stops", () => {
        expect(drawn("plain")).toBe("plain|");
    });

    it("puts the caret on $0 when it is the only stop", () => {
        expect(drawn("a$0b")).toBe("a|b");
        expect(drawn("a${0}b")).toBe("a|b");
    });

    it("prefers the lowest positive stop over $0 and over later stops", () => {
        expect(drawn("$0 a $2 b $1 c")).toBe(" a  b | c");
    });

    it("uses the first occurrence of a mirrored stop", () => {
        expect(drawn("x$1 y$1")).toBe("x| y");
    });

    it("selects the text of a placeholder and takes the first choice", () => {
        expect(drawn("a ${1:name} b")).toBe("a [name] b");
        expect(drawn("a ${1|one,two|} b")).toBe("a [one] b");
    });

    it("unescapes a dollar instead of reading a stop from it", () => {
        expect(drawn("\\$5 $1")).toBe("$5 |");
    });

    it("leaves variables as literal text", () => {
        expect(drawn("$TM_FILENAME")).toBe("$TM_FILENAME|");
    });

    it("adds the line's indentation to every further line, not to the start", () => {
        expect(drawn("\n    $0\n", "    ")).toBe("\n        |\n    ");
    });

    it("indents text that follows a line break after a stop-free segment", () => {
        expect(drawn("\n$1x", "  ")).toBe("\n  |x");
    });

    it("does not indent a segment continuing a line", () => {
        expect(drawn("a$1b\nc", "  ")).toBe("a|b\n  c");
    });

    it("normalizes the start of the snippet without adding the line's indentation", () => {
        expect(drawn("\tx", "    ")).toBe("    x|");
    });

    it("converts indentation to tabs when the editor uses tabs", () => {
        expect(drawn("\n      x$0", "    ", TABS_4)).toBe("\n\t\t  x|");
    });

    it("counts a tab up to the next tab stop column", () => {
        expect(drawn("\n  \tx$0", "", SPACES_4)).toBe("\n    x|");
    });

    it("keeps whitespace verbatim with keepWhitespace", () => {
        expect(drawn("\n\t$0\n", "    ", null)).toBe("\n\t|\n");
    });

    it("treats every line ending of a template as a line break", () => {
        expect(drawn("a\r\nb\rc", "  ")).toBe("a\n  b\n  c|");
    });
});
