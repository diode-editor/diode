import { describe, expect, it } from "vitest";

import { TextDocument } from "../../common/model/textDocument.ts";

import { findMatches, findTextMatches } from "./findMatches.ts";

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
        // Non-overlapping: positions 0 and 2 (not 0,1,2).
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

describe("findTextMatches — границы слова", () => {
    const whole = (text: string, query: string): number[] =>
        findTextMatches(new TextDocument(text), query, { matchCase: true, wholeWord: true }).map(
            (match) => match.start.character,
        );

    it("слово у самого начала и у самого конца строки — целое слово", () => {
        // За краями строки символов нет, и край считается границей слова.
        expect(whole("text context text", "text")).toEqual([0, 13]);
    });

    it("часть слова не находится — ни по левому соседу, ни по правому", () => {
        // `textual` отсекается символом СПРАВА, `pretext` — слева. Без правой
        // проверки нашлось бы и начало `textual`.
        expect(whole("textual text pretext", "text")).toEqual([8]);
    });
});
