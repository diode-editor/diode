import { describe, expect, it } from "vitest";

import { createCursorSelection, createSelection, selectionToRange } from "../../common/core/iSelection.ts";
import { TextDocument } from "../../common/model/textDocument.ts";
import { EditorViewState } from "../../common/viewModel/editorViewState.ts";

import {
    addSelectionToNextFindMatch,
    addSelectionToPreviousFindMatch,
    insertCursorAtEndOfEachLineSelected,
    moveSelectionToNextFindMatch,
    moveSelectionToPreviousFindMatch,
    selectHighlights,
} from "./multiCursorCommands.ts";

function texts(state: EditorViewState): string[] {
    return state.selections.map((sel) => state.document.getTextInRange(selectionToRange(sel)));
}

/** `[line, start, end]`: all selections are single-line. */
function spans(state: EditorViewState): number[][] {
    return state.selections.map((sel) => {
        const range = selectionToRange(sel);
        return [range.start.line, range.start.character, range.end.character];
    });
}

function makeState(text: string, line = 0, character = 0): EditorViewState {
    const state = new EditorViewState(new TextDocument(text), [createCursorSelection(line, character)]);
    state.viewportWidth = 80;
    state.viewportHeight = 20;
    return state;
}

describe("addSelectionToNextFindMatch (Ctrl+D)", () => {
    it("first press selects the word under the cursor, second adds the next occurrence", () => {
        const state = makeState("foo bar\nfoo baz", 0, 1);

        addSelectionToNextFindMatch(state);
        expect(spans(state)).toEqual([[0, 0, 3]]);

        addSelectionToNextFindMatch(state);
        expect(spans(state)).toEqual([
            [0, 0, 3],
            [1, 0, 3],
        ]);
        expect(texts(state)).toEqual(["foo", "foo"]);
    });

    it("wraps around after the last occurrence and then becomes a no-op", () => {
        const state = makeState("foo\nfoo\nfoo", 0, 0);
        addSelectionToNextFindMatch(state); // selects the word
        addSelectionToNextFindMatch(state);
        addSelectionToNextFindMatch(state);
        expect(state.selections).toHaveLength(3);

        let fired = 0;
        state.onDidChangeCursorPosition(() => {
            fired++;
        });
        addSelectionToNextFindMatch(state);
        expect(state.selections).toHaveLength(3);
        expect(fired).toBe(0);
    });

    it("from a non-empty selection adds the second occurrence right away", () => {
        const state = makeState("foobar foobar");
        state.selections = [createSelection(0, 0, 0, 4)];

        addSelectionToNextFindMatch(state);
        expect(spans(state)).toEqual([
            [0, 0, 4],
            [0, 7, 11],
        ]);
    });

    it("searches whole words when started from a cursor", () => {
        const state = makeState("text context text", 0, 1);
        addSelectionToNextFindMatch(state);
        addSelectionToNextFindMatch(state);
        // `text` inside `context` is skipped.
        expect(spans(state)).toEqual([
            [0, 0, 4],
            [0, 13, 17],
        ]);
    });

    it("single occurrence: second press adds nothing", () => {
        const state = makeState("alpha beta", 0, 0);
        addSelectionToNextFindMatch(state);
        addSelectionToNextFindMatch(state);
        expect(state.selections).toHaveLength(1);
    });

    it("cursor not on a word: the command does nothing", () => {
        const state = makeState("a + b", 0, 2);
        addSelectionToNextFindMatch(state);
        expect(state.selections).toHaveLength(1);
        expect(state.selections[0].active).toEqual({ line: 0, character: 2 });
    });

    it("viewport moves to the added occurrence instead of staying at the primary", () => {
        const filler = Array.from({ length: 60 }, () => "filler").join("\n");
        const state = makeState(`foo\n${filler}\nfoo`, 0, 0);
        state.viewportHeight = 10;

        addSelectionToNextFindMatch(state);
        addSelectionToNextFindMatch(state);

        expect(state.selections).toHaveLength(2);
        expect(state.scrollTop).toBeGreaterThan(0);
    });

    it("first step reveals the word under the cursor", () => {
        const filler = Array.from({ length: 60 }, () => "filler").join("\n");
        const state = makeState(`${filler}\nfoo`, 60, 0);
        state.viewportHeight = 10;
        // Cursor at the bottom of the file, viewport at the top: the user scrolled away.
        state.scrollTop = 0;

        addSelectionToNextFindMatch(state); // the first step only selects the word

        expect(spans(state)).toEqual([[60, 0, 3]]);
        expect(state.scrollTop).toBeGreaterThan(0);
    });

    it("wrap to the top scrolls the viewport up to the found occurrence", () => {
        const filler = Array.from({ length: 60 }, () => "filler").join("\n");
        const state = makeState(`foo\n${filler}\nfoo`, 61, 0);
        state.viewportHeight = 10;
        state.scrollTop = 52;

        addSelectionToNextFindMatch(state); // selects the bottom word
        addSelectionToNextFindMatch(state); // wraps to the top one

        expect(state.scrollTop).toBe(0);
    });
});

describe("addSelectionToNextFindMatch session invalidation", () => {
    it("cursor movement between steps restarts the search from the new position", () => {
        const state = makeState("foo bar\nfoo bar", 0, 0);
        addSelectionToNextFindMatch(state);
        addSelectionToNextFindMatch(state);
        expect(texts(state)).toEqual(["foo", "foo"]);

        // The user moved the cursor away: the session is stale.
        state.selections = [createCursorSelection(0, 5)];
        addSelectionToNextFindMatch(state);
        expect(texts(state)).toEqual(["bar"]);
    });

    it("document edit restarts the search", () => {
        const state = makeState("foo bar\nfoo bar", 0, 0);
        addSelectionToNextFindMatch(state);
        addSelectionToNextFindMatch(state);

        state.selections = [createCursorSelection(1, 4)];
        state.type("X");
        addSelectionToNextFindMatch(state);
        // After the edit the word under the cursor is `Xbar`, and it is unique.
        expect(texts(state)).toEqual(["Xbar"]);
    });

    it("multiple cursors with different text: the step expands them to words", () => {
        const state = makeState("alpha beta", 0, 0);
        state.selections = [createCursorSelection(0, 1), createCursorSelection(0, 7)];

        addSelectionToNextFindMatch(state);

        expect(texts(state)).toEqual(["alpha", "beta"]);
    });

    it("expands only collapsed selections, leaves non-empty ones untouched", () => {
        const state = makeState("alpha beta");
        state.selections = [createSelection(0, 0, 0, 2), createCursorSelection(0, 7)];

        addSelectionToNextFindMatch(state);

        expect(texts(state)).toEqual(["al", "beta"]);
    });

    it("cursor on punctuation among others stays a cursor", () => {
        const state = makeState("alpha + beta");
        state.selections = [createCursorSelection(0, 1), createCursorSelection(0, 6)];

        addSelectionToNextFindMatch(state);

        expect(texts(state)).toEqual(["alpha", ""]);
    });

    it("nothing to expand: selections untouched and no event fired", () => {
        const state = makeState("a + b");
        state.selections = [createCursorSelection(0, 2), createSelection(0, 3, 0, 4)];
        let fired = 0;
        state.onDidChangeCursorPosition(() => {
            fired++;
        });

        addSelectionToNextFindMatch(state);

        expect(fired).toBe(0);
    });

    it("selections differing in case do not count as common text", () => {
        // The search is case-sensitive, so the shared-text gate must be too.
        const state = makeState("Foo foo Foo");
        state.selections = [createSelection(0, 0, 0, 3), createSelection(0, 4, 0, 7)];

        addSelectionToNextFindMatch(state);

        expect(state.selections).toHaveLength(2);
    });

    it("multiple selections with the SAME text continue the search right away", () => {
        const state = makeState("foo foo foo");
        state.selections = [createSelection(0, 0, 0, 3), createSelection(0, 4, 0, 7)];

        addSelectionToNextFindMatch(state);

        expect(spans(state)).toEqual([
            [0, 0, 3],
            [0, 4, 7],
            [0, 8, 11],
        ]);
    });
});

describe("addSelectionToPreviousFindMatch", () => {
    it("adds an occurrence above in the document", () => {
        const state = makeState("foo\nbar\nfoo", 2, 1);
        addSelectionToPreviousFindMatch(state); // selects the word
        addSelectionToPreviousFindMatch(state);
        expect(spans(state)).toEqual([
            [0, 0, 3],
            [2, 0, 3],
        ]);
    });

    // Two occurrences cannot check direction: the search wraps, so "up" from the bottom one
    // lands where "down" does. Three occurrences and a start in the middle make up and down
    // diverge.
    it("goes UP indeed: from the middle takes the occurrence above the cursor, not below", () => {
        const state = makeState("foo\nfoo\nfoo", 1, 1);

        addSelectionToPreviousFindMatch(state); // selects the word under the cursor
        expect(spans(state)).toEqual([[1, 0, 3]]);

        addSelectionToPreviousFindMatch(state);

        expect(spans(state)).toEqual([
            [0, 0, 3],
            [1, 0, 3],
        ]);
    });
});

describe("moveSelectionToNextFindMatch (Ctrl+K Ctrl+D)", () => {
    it("moves the last added selection without growing their count", () => {
        const state = makeState("foo\nfoo\nfoo", 0, 0);
        addSelectionToNextFindMatch(state);
        addSelectionToNextFindMatch(state);
        expect(spans(state)).toEqual([
            [0, 0, 3],
            [1, 0, 3],
        ]);

        moveSelectionToNextFindMatch(state);
        expect(spans(state)).toEqual([
            [0, 0, 3],
            [2, 0, 3],
        ]);
    });

    it("moves backwards too", () => {
        const state = makeState("foo\nfoo\nfoo", 0, 0);
        addSelectionToNextFindMatch(state);
        addSelectionToNextFindMatch(state);

        moveSelectionToPreviousFindMatch(state);
        expect(spans(state)).toEqual([
            [0, 0, 3],
            [2, 0, 3],
        ]);
    });

    // The check above with three occurrences cannot tell direction: exactly one spot stays free,
    // and both up-with-wrap and down lead to it. With four occurrences and a move from the
    // middle the paths diverge.
    it("backwards means backwards: moving from the middle goes up, not down", () => {
        const state = makeState("foo\nfoo\nfoo\nfoo", 1, 0);
        addSelectionToNextFindMatch(state); // selects line 1
        addSelectionToNextFindMatch(state); // adds line 2

        moveSelectionToPreviousFindMatch(state);

        // Line 1 is taken by the other selection, so the step up skips it and lands on line 0.
        // A step down would land on line 3.
        expect(spans(state)).toEqual([
            [0, 0, 3],
            [1, 0, 3],
        ]);
    });

    it("does not get stuck on a single occurrence: the previous spot is free again", () => {
        const state = makeState("foo bar", 0, 0);
        addSelectionToNextFindMatch(state);
        moveSelectionToNextFindMatch(state);
        expect(spans(state)).toEqual([[0, 0, 3]]);
    });
});

describe("selectHighlights (Ctrl+Shift+L)", () => {
    it("selects all occurrences of the word under the cursor at once", () => {
        const state = makeState("foo bar\nfoo baz\nfoo", 0, 1);
        selectHighlights(state);
        expect(spans(state)).toEqual([
            [0, 0, 3],
            [1, 0, 3],
            [2, 0, 3],
        ]);
    });

    it("repeated call changes nothing", () => {
        const state = makeState("foo\nfoo", 0, 0);
        selectHighlights(state);
        selectHighlights(state);
        expect(state.selections).toHaveLength(2);
    });

    it("Ctrl+D after it is a stable no-op: everything is selected already", () => {
        const state = makeState("foo\nfoo", 0, 0);
        selectHighlights(state);
        addSelectionToNextFindMatch(state);
        expect(state.selections).toHaveLength(2);
    });

    it("picks up a live Ctrl+D session instead of restarting from the cursor", () => {
        const state = makeState("foobar foobar foobar");
        state.selections = [createSelection(0, 0, 0, 4)]; // substring "foob"
        addSelectionToNextFindMatch(state);

        selectHighlights(state);
        expect(state.selections).toHaveLength(3);
        expect(texts(state)).toEqual(["foob", "foob", "foob"]);
    });

    it("viewport stays at the previous cursor instead of jumping to file start", () => {
        const filler = Array.from({ length: 60 }, () => "filler").join("\n");
        const state = makeState(`foo\n${filler}\nfoo`, 61, 1);
        state.viewportHeight = 10;
        state.scrollTop = 52;

        selectHighlights(state);

        expect(state.selections).toHaveLength(2);
        expect(state.scrollTop).toBeGreaterThan(0);
    });

    it("cursor not on a word is a no-op", () => {
        const state = makeState("a + b", 0, 2);
        selectHighlights(state);
        expect(state.selections).toHaveLength(1);
    });
});

describe("insertCursorAtEndOfEachLineSelected (Ctrl+Shift+Alt+I)", () => {
    it("puts a cursor at the end of each touched line", () => {
        const state = makeState("alpha\nbe\ngamma");
        state.selections = [createSelection(0, 1, 2, 3)];

        insertCursorAtEndOfEachLineSelected(state);

        expect(state.selections.map((sel) => [sel.active.line, sel.active.character])).toEqual([
            [0, 5],
            [1, 2],
            [2, 3],
        ]);
    });

    it("selection ending at column 0 adds no cursor on its last line", () => {
        const state = makeState("alpha\nbeta\ngamma");
        state.selections = [createSelection(0, 0, 2, 0)];

        insertCursorAtEndOfEachLineSelected(state);

        expect(state.selections.map((sel) => sel.active.line)).toEqual([0, 1]);
    });

    it("all selections collapsed: no-op without an event", () => {
        const state = makeState("alpha\nbeta", 0, 2);
        let fired = 0;
        state.onDidChangeCursorPosition(() => {
            fired++;
        });
        insertCursorAtEndOfEachLineSelected(state);
        expect(state.selections).toHaveLength(1);
        expect(fired).toBe(0);
    });

    it("reveals the first of the placed cursors", () => {
        const filler = Array.from({ length: 60 }, () => "filler").join("\n");
        const state = makeState(filler, 0, 0);
        state.viewportHeight = 10;
        state.selections = [createSelection(56, 0, 58, 2)];
        state.scrollTop = 0;

        insertCursorAtEndOfEachLineSelected(state);

        expect(state.selections).toHaveLength(3);
        expect(state.scrollTop).toBeGreaterThan(0);
    });

    it("resets the Ctrl+D session: the cursor set no longer belongs to it", () => {
        const state = makeState("foo\nfoo", 0, 0);
        addSelectionToNextFindMatch(state);
        expect(state.multiCursorSession).not.toBeNull();

        state.selections = [createSelection(0, 0, 1, 3)];
        insertCursorAtEndOfEachLineSelected(state);
        expect(state.multiCursorSession).toBeNull();
    });
});

describe("multi-cursor find in read-only", () => {
    it("works: selecting changes nothing in the document", () => {
        const state = makeState("foo\nfoo", 0, 0);
        state.readOnly = true;
        addSelectionToNextFindMatch(state);
        addSelectionToNextFindMatch(state);
        expect(state.selections).toHaveLength(2);
    });
});
