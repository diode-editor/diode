import { describe, expect, it } from "vitest";

import { createRange } from "../../common/core/iRange.ts";
import { TextDocument } from "../../common/model/textDocument.ts";

import {
    findMatches,
    findNextMatch,
    findPreviousMatch,
    findTextMatches,
    type ITextMatchOptions,
} from "./findMatches.ts";

describe("findMatches", () => {
    it("returns no matches for an empty query", () => {
        const doc = new TextDocument("hello world");
        expect(findMatches(doc, "")).toEqual([]);
    });

    it("finds a single match with correct range", () => {
        const doc = new TextDocument("hello world");
        const matches = findMatches(doc, "world");
        expect(matches).toHaveLength(1);
        expect(matches[0]).toEqual({
            start: { line: 0, character: 6 },
            end: { line: 0, character: 11 },
        });
    });

    it("is case-insensitive", () => {
        const doc = new TextDocument("Foo foo FOO");
        const matches = findMatches(doc, "foo");
        expect(matches).toHaveLength(3);
        expect(matches.map((m) => m.start.character)).toEqual([0, 4, 8]);
    });

    it("finds multiple matches on one line", () => {
        const doc = new TextDocument("a-a-a");
        const matches = findMatches(doc, "a");
        expect(matches.map((m) => m.start.character)).toEqual([0, 2, 4]);
    });

    it("does not return overlapping matches", () => {
        const doc = new TextDocument("aaaa");
        const matches = findMatches(doc, "aa");
        expect(matches.map((m) => m.start.character)).toEqual([0, 2]);
    });

    it("finds matches across multiple lines", () => {
        const doc = new TextDocument("foo\nbar foo\nbaz");
        const matches = findMatches(doc, "foo");
        expect(matches).toHaveLength(2);
        expect(matches[0].start).toEqual({ line: 0, character: 0 });
        expect(matches[1].start).toEqual({ line: 1, character: 4 });
    });

    it("returns no matches when the query is absent", () => {
        const doc = new TextDocument("hello world");
        expect(findMatches(doc, "xyz")).toEqual([]);
    });

    it("returns no matches when the query is longer than any line", () => {
        const doc = new TextDocument("hi");
        expect(findMatches(doc, "hello")).toEqual([]);
    });

    it("handles an empty document", () => {
        const doc = new TextDocument("");
        expect(doc.lineCount).toBe(1);
        expect(findMatches(doc, "foo")).toEqual([]);
    });
});

describe("findTextMatches word boundaries", () => {
    const whole = (text: string, query: string): number[] =>
        findTextMatches(new TextDocument(text), query, { matchCase: true, wholeWord: true }).map(
            (match) => match.start.character,
        );

    it("word at the very start and the very end of a line is a whole word", () => {
        expect(whole("text context text", "text")).toEqual([0, 13]);
    });

    it("part of a word is not found, by neither the left nor the right neighbor", () => {
        // `textual` is rejected by the char on the RIGHT, `pretext` by the left one. Without
        // the right check, the start of `textual` would match too.
        expect(whole("textual text pretext", "text")).toEqual([8]);
    });
});

/**
 * Upstream `findNextMatch`/`findPreviousMatch`: how Next and Prev move once the collection stopped at
 * `MATCHES_LIMIT` and the list does not hold the whole document.
 */
describe("findNextMatch / findPreviousMatch", () => {
    const PLAIN: ITextMatchOptions = { matchCase: false, wholeWord: false };
    const doc = new TextDocument("foo bar foo\nnothing\nfoo foofoo");

    it("next: the first match at or after the position, same line included", () => {
        expect(findNextMatch(doc, { line: 0, character: 0 }, "foo", PLAIN)).toEqual(createRange(0, 0, 0, 3));
        expect(findNextMatch(doc, { line: 0, character: 1 }, "foo", PLAIN)).toEqual(createRange(0, 8, 0, 11));
        expect(findNextMatch(doc, { line: 0, character: 11 }, "foo", PLAIN)).toEqual(createRange(2, 0, 2, 3));
        expect(findNextMatch(doc, { line: 2, character: 4 }, "foo", PLAIN)).toEqual(createRange(2, 4, 2, 7));
    });

    it("next wraps around the end of the document back to the first match", () => {
        expect(findNextMatch(doc, { line: 2, character: 8 }, "foo", PLAIN)).toEqual(createRange(0, 0, 0, 3));
        expect(findNextMatch(doc, { line: 2, character: 10 }, "foo", PLAIN)).toEqual(createRange(0, 0, 0, 3));
    });

    it("previous: the last match that ends at or before the position, wrapping around the start", () => {
        expect(findPreviousMatch(doc, { line: 2, character: 10 }, "foo", PLAIN)).toEqual(createRange(2, 7, 2, 10));
        expect(findPreviousMatch(doc, { line: 2, character: 9 }, "foo", PLAIN)).toEqual(createRange(2, 4, 2, 7));
        expect(findPreviousMatch(doc, { line: 2, character: 0 }, "foo", PLAIN)).toEqual(createRange(0, 8, 0, 11));
        expect(findPreviousMatch(doc, { line: 0, character: 3 }, "foo", PLAIN)).toEqual(createRange(0, 0, 0, 3));
        expect(findPreviousMatch(doc, { line: 0, character: 0 }, "foo", PLAIN)).toEqual(createRange(2, 7, 2, 10));
    });

    it("a lone match is its own next and previous", () => {
        const lone = new TextDocument("a\nb\nc");
        expect(findNextMatch(lone, { line: 1, character: 1 }, "b", PLAIN)).toEqual(createRange(1, 0, 1, 1));
        expect(findPreviousMatch(lone, { line: 1, character: 0 }, "b", PLAIN)).toEqual(createRange(1, 0, 1, 1));
    });

    it("no match anywhere, or an empty query: null", () => {
        expect(findNextMatch(doc, { line: 0, character: 0 }, "zzz", PLAIN)).toBeNull();
        expect(findPreviousMatch(doc, { line: 0, character: 0 }, "zzz", PLAIN)).toBeNull();
        expect(findNextMatch(doc, { line: 0, character: 0 }, "", PLAIN)).toBeNull();
        expect(findPreviousMatch(doc, { line: 0, character: 0 }, "", PLAIN)).toBeNull();
    });

    it("honours the match options", () => {
        const strict: ITextMatchOptions = { matchCase: true, wholeWord: true };
        const cased = new TextDocument("Foo foobar foo");
        expect(findNextMatch(cased, { line: 0, character: 0 }, "foo", strict)).toEqual(createRange(0, 11, 0, 14));
        expect(findPreviousMatch(cased, { line: 0, character: 10 }, "foo", strict)).toEqual(createRange(0, 11, 0, 14));
    });
});
