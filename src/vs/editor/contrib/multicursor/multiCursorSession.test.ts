import { describe, expect, it } from "vitest";

import { createRange } from "../../common/core/iRange.ts";
import { createCursorSelection, createSelection, withIdealColumn } from "../../common/core/iSelection.ts";
import { TextDocument } from "../../common/model/textDocument.ts";

import {
    captureSession,
    deriveSearchSpec,
    findNextOccurrence,
    isSessionCurrent,
    selectionsShareText,
} from "./multiCursorSession.ts";

const SUBSTRING = { searchText: "foo", wholeWord: false, matchCase: true };

describe("deriveSearchSpec", () => {
    it("collapsed cursor on a word yields the word and whole-word search", () => {
        const doc = new TextDocument("foo bar");
        const spec = deriveSearchSpec(doc, createCursorSelection(0, 1));
        expect(spec).toEqual({
            searchText: "foo",
            wholeWord: true,
            matchCase: true,
            range: createRange(0, 0, 0, 3),
        });
    });

    it("cursor right after a word is still on it", () => {
        const doc = new TextDocument("foo bar");
        expect(deriveSearchSpec(doc, createCursorSelection(0, 3))?.searchText).toBe("foo");
    });

    it("cursor in whitespace between words yields nothing", () => {
        // Two spaces: position 4 touches no word.
        const doc = new TextDocument("foo  bar");
        expect(deriveSearchSpec(doc, createCursorSelection(0, 4))).toBeNull();
    });

    it("cursor on punctuation yields nothing", () => {
        const doc = new TextDocument("a + b");
        expect(deriveSearchSpec(doc, createCursorSelection(0, 2))).toBeNull();
    });

    it("non-empty single-line selection is searched as a substring", () => {
        const doc = new TextDocument("foobar");
        expect(deriveSearchSpec(doc, createSelection(0, 0, 0, 4))).toEqual({
            searchText: "foob",
            wholeWord: false,
            matchCase: true,
            range: createRange(0, 0, 0, 4),
        });
    });

    it("multi-line selection is not supported", () => {
        const doc = new TextDocument("foo\nbar");
        expect(deriveSearchSpec(doc, createSelection(0, 0, 1, 3))).toBeNull();
    });
});

describe("findNextOccurrence", () => {
    const doc = new TextDocument("foo one foo\ntwo foo three");

    it("goes forward from the reference point", () => {
        const next = findNextOccurrence(doc, SUBSTRING, createRange(0, 0, 0, 3), 1, []);
        expect(next).toEqual(createRange(0, 8, 0, 11));
    });

    it("wraps around the document end", () => {
        const next = findNextOccurrence(doc, SUBSTRING, createRange(1, 4, 1, 7), 1, []);
        expect(next).toEqual(createRange(0, 0, 0, 3));
    });

    it("goes backwards", () => {
        const next = findNextOccurrence(doc, SUBSTRING, createRange(1, 4, 1, 7), -1, []);
        expect(next).toEqual(createRange(0, 8, 0, 11));
    });

    it("wraps around the document start", () => {
        const next = findNextOccurrence(doc, SUBSTRING, createRange(0, 0, 0, 3), -1, []);
        expect(next).toEqual(createRange(1, 4, 1, 7));
    });

    it("skips already taken occurrences", () => {
        const taken = [createRange(0, 0, 0, 3), createRange(0, 8, 0, 11)];
        expect(findNextOccurrence(doc, SUBSTRING, createRange(0, 0, 0, 3), 1, taken)).toEqual(createRange(1, 4, 1, 7));
    });

    it("all occurrences taken yields null", () => {
        const taken = [createRange(0, 0, 0, 3), createRange(0, 8, 0, 11), createRange(1, 4, 1, 7)];
        expect(findNextOccurrence(doc, SUBSTRING, createRange(0, 0, 0, 3), 1, taken)).toBeNull();
    });

    it("no occurrences at all yields null", () => {
        const spec = { searchText: "zzz", wholeWord: false, matchCase: true };
        expect(findNextOccurrence(doc, spec, createRange(0, 0, 0, 3), 1, [])).toBeNull();
    });

    it("whole-word: text inside context is not found", () => {
        const words = new TextDocument("text context text");
        const spec = { searchText: "text", wholeWord: true, matchCase: true };
        expect(findNextOccurrence(words, spec, createRange(0, 0, 0, 4), 1, [])).toEqual(createRange(0, 13, 0, 17));
    });

    it("matchCase: FOO is not found by foo", () => {
        const mixed = new TextDocument("foo FOO");
        // `foo` itself is taken, so if `FOO` counted as a match, it would be found.
        const taken = [createRange(0, 0, 0, 3)];
        expect(findNextOccurrence(mixed, SUBSTRING, createRange(0, 0, 0, 3), 1, taken)).toBeNull();
    });
});

describe("isSessionCurrent", () => {
    const doc = new TextDocument("foo bar");
    const selections = [createSelection(0, 0, 0, 3)];
    const session = captureSession(SUBSTRING, createRange(0, 0, 0, 3), selections, doc.versionId);

    it("match means the session is alive", () => {
        expect(isSessionCurrent(session, selections, doc.versionId)).toBe(true);
    });

    it("cursor moved: the session is stale", () => {
        expect(isSessionCurrent(session, [createSelection(0, 1, 0, 3)], doc.versionId)).toBe(false);
    });

    it("ONE of two selections moved: the session is stale", () => {
        // All must match: with a single selection "all match" and "at least one matches" are
        // indistinguishable, with a pair the difference shows.
        const pair = [createSelection(0, 0, 0, 3), createSelection(0, 4, 0, 7)];
        const pairSession = captureSession(SUBSTRING, createRange(0, 0, 0, 3), pair, doc.versionId);

        expect(isSessionCurrent(pairSession, [pair[0], createSelection(0, 5, 0, 7)], doc.versionId)).toBe(false);
    });

    it("selection count changed: the session is stale", () => {
        expect(isSessionCurrent(session, [...selections, createCursorSelection(0, 5)], doc.versionId)).toBe(false);
    });

    it("document changed: the session is stale", () => {
        expect(isSessionCurrent(session, selections, doc.versionId + 1)).toBe(false);
    });

    it("only idealColumn changed: the session is ALIVE", () => {
        expect(isSessionCurrent(session, [withIdealColumn(selections[0], 42)], doc.versionId)).toBe(true);
    });
});

describe("selectionsShareText", () => {
    const doc = new TextDocument("foo bar\nfoo baz");

    it("same text in all selections", () => {
        expect(selectionsShareText(doc, [createSelection(0, 0, 0, 3), createSelection(1, 0, 1, 3)], true)).toBe(true);
    });

    it("different text", () => {
        expect(selectionsShareText(doc, [createSelection(0, 0, 0, 3), createSelection(0, 4, 0, 7)], true)).toBe(false);
    });

    it("collapsed cursor breaks commonality", () => {
        expect(selectionsShareText(doc, [createSelection(0, 0, 0, 3), createCursorSelection(1, 0)], true)).toBe(false);
    });

    it("two collapsed cursors form no common text", () => {
        // Empty texts are formally "equal", but emptiness alone rules out shared text.
        expect(selectionsShareText(doc, [createCursorSelection(0, 0), createCursorSelection(1, 0)], true)).toBe(false);
    });

    it("multi-line selection breaks commonality", () => {
        expect(selectionsShareText(doc, [createSelection(0, 0, 1, 3)], true)).toBe(false);
    });

    it("case folds to lower, as in the search itself", () => {
        // `ß` and `ss` both uppercase to `SS`, but the match scanner compares lowercase: if the two
        // disagreed, Ctrl+D would continue a session on text the search cannot find.
        const sharp = new TextDocument("ß ss");
        const selections = [createSelection(0, 0, 0, 1), createSelection(0, 2, 0, 4)];
        expect(selectionsShareText(sharp, selections, false)).toBe(false);
    });

    it("case-insensitively FOO and foo count as one text", () => {
        const mixed = new TextDocument("foo FOO");
        const selections = [createSelection(0, 0, 0, 3), createSelection(0, 4, 0, 7)];
        expect(selectionsShareText(mixed, selections, false)).toBe(true);
        expect(selectionsShareText(mixed, selections, true)).toBe(false);
    });
});
