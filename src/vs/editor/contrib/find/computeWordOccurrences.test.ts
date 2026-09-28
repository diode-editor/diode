import { describe, expect, it } from "vitest";

import { createRange } from "../../common/core/iRange.ts";
import { TextDocument } from "../../common/model/textDocument.ts";

import { computeWordOccurrences } from "./computeWordOccurrences.ts";

function occurrences(text: string, line: number, character: number) {
    return computeWordOccurrences(new TextDocument(text), { line, character });
}

describe("computeWordOccurrences", () => {
    it("finds every occurrence of the word the cursor sits inside", () => {
        // "foo bar foo" — cursor inside the first "foo".
        expect(occurrences("foo bar foo", 0, 1)).toEqual([createRange(0, 0, 0, 3), createRange(0, 8, 0, 11)]);
    });

    it("spans multiple lines in document order", () => {
        const text = "foo\nbar foo\nfoo";
        expect(occurrences(text, 0, 0)).toEqual([
            createRange(0, 0, 0, 3),
            createRange(1, 4, 1, 7),
            createRange(2, 0, 2, 3),
        ]);
    });

    it("includes the sole occurrence under the cursor", () => {
        expect(occurrences("hello world", 0, 2)).toEqual([createRange(0, 0, 0, 5)]);
    });

    it("treats the caret just past a word's end as being on that word", () => {
        // "foo bar" — caret at offset 3, immediately after "foo".
        expect(occurrences("foo bar foo", 0, 3)).toEqual([createRange(0, 0, 0, 3), createRange(0, 8, 0, 11)]);
    });

    it("prefers the word at the caret over the one to its left", () => {
        // "foo.bar" — caret at offset 4 sits between '.' and 'bar' → picks "bar".
        expect(occurrences("foo.bar bar", 0, 4)).toEqual([createRange(0, 4, 0, 7), createRange(0, 8, 0, 11)]);
    });

    it("returns nothing when the cursor is on whitespace", () => {
        expect(occurrences("foo bar", 0, 3)).not.toEqual([]); // sanity: offset 3 is end of foo
        expect(occurrences("foo  bar", 0, 4)).toEqual([]); // offset 4 is between two spaces
    });

    it("returns nothing when the cursor is on a separator", () => {
        expect(occurrences("a . a", 0, 2)).toEqual([]);
    });

    it("matches whole words only — substrings are ignored", () => {
        // "text in context" — "context" contains "text" but must not match.
        expect(occurrences("text in context", 0, 0)).toEqual([createRange(0, 0, 0, 4)]);
    });

    it("is case-sensitive", () => {
        // Cursor on lower-case "foo"; "Foo" and "FOO" must not match.
        expect(occurrences("foo Foo FOO foo", 0, 0)).toEqual([createRange(0, 0, 0, 3), createRange(0, 12, 0, 15)]);
    });

    it("returns nothing for an out-of-range line", () => {
        expect(occurrences("foo", 5, 0)).toEqual([]);
    });

    it("handles a word at the very end of a line (no trailing char)", () => {
        expect(occurrences("bar\nbar", 0, 3)).toEqual([createRange(0, 0, 0, 3), createRange(1, 0, 1, 3)]);
    });

    /**
     * Highlight зовётся из `EditorElement.render`, и каретка приходит из
     * состояния вью — за кадр она бывает «протухшей» (правка мимо вью, позиция от
     * расширения). Колонка за концом строки роняла ВЕСЬ редактор
     * (`TypeError: Cannot read properties of undefined (reading 'length')`
     * в `isWordChar`), поэтому граница проверяется именно здесь, на живом
     * документе, а не только у `findWordRangeAt`.
     */
    it("колонка за концом строки не роняет highlight, а берёт слово у конца", () => {
        expect(occurrences("bar\nbar", 0, 9)).toEqual([createRange(0, 0, 0, 3), createRange(1, 0, 1, 3)]);
    });

    it("отрицательная колонка не роняет highlight", () => {
        expect(occurrences("bar\nbar", 0, -3)).toEqual([createRange(0, 0, 0, 3), createRange(1, 0, 1, 3)]);
    });
});
