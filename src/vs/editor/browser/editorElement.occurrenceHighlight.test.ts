import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../TestUtils/TestApp.ts";
import { createRange } from "../common/core/iRange.ts";
import { createCursorSelection, createSelection } from "../common/core/iSelection.ts";
import { DocumentHighlightKind, wordHighlightSetOf } from "../common/languages/iDocumentHighlightSource.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

const OCCURRENCE_BG = packRgb(71, 71, 71);
// Upstream `WordHighlighter.runDelayer`.
const RUN_DELAY_MS = 50;

function createEditor(
    text: string,
    width = 30,
    height = 5,
): { app: TestApp; editor: EditorElement; viewState: EditorViewState; gw: number } {
    const doc = new TextDocument(text);
    const viewState = new EditorViewState(doc);
    const editor = new EditorElement(viewState);
    const app = TestApp.createWithContent(editor, new Size(width, height));
    return { app, editor, viewState, gw: editor.gutterWidth };
}

/** The frame arms the query, the timer runs it, the next frame paints it. */
function settle(app: TestApp): void {
    app.render();
    vi.advanceTimersByTime(RUN_DELAY_MS);
    app.render();
}

function press(editor: EditorElement, key: string): void {
    editor.dispatchEvent(new TUIKeyboardEvent("keypress", { key }));
}

describe("EditorElement — occurrence highlight (word under cursor)", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("highlights every occurrence of the word under the cursor", () => {
        const { app, viewState, gw } = createEditor("foo bar foo");
        viewState.selections = [createCursorSelection(0, 1)];
        settle(app);

        expect(app.backend.getBgAt(new Point(gw + 0, 0))).toBe(OCCURRENCE_BG);
        expect(app.backend.getBgAt(new Point(gw + 2, 0))).toBe(OCCURRENCE_BG);
        expect(app.backend.getBgAt(new Point(gw + 8, 0))).toBe(OCCURRENCE_BG);
        expect(app.backend.getBgAt(new Point(gw + 10, 0))).toBe(OCCURRENCE_BG);
    });

    it("computes the occurrences after the frame, once the cursor settles", () => {
        const { app, editor, viewState, gw } = createEditor("foo bar foo");
        viewState.selections = [createCursorSelection(0, 1)];
        app.render();
        expect(app.backend.getBgAt(new Point(gw + 8, 0))).toBe(editor.resolvedStyle.bg);

        vi.advanceTimersByTime(RUN_DELAY_MS - 1);
        app.render();
        expect(app.backend.getBgAt(new Point(gw + 8, 0))).toBe(editor.resolvedStyle.bg);

        vi.advanceTimersByTime(1);
        app.render();
        expect(app.backend.getBgAt(new Point(gw + 8, 0))).toBe(OCCURRENCE_BG);
    });

    it("highlights the word under the initial cursor without a cursor move", () => {
        const { app, gw } = createEditor("foo bar foo");
        settle(app);

        expect(app.backend.getBgAt(new Point(gw + 8, 0))).toBe(OCCURRENCE_BG);
    });

    it("does not highlight the intervening non-matching word", () => {
        const { app, editor, viewState, gw } = createEditor("foo bar foo");
        viewState.selections = [createCursorSelection(0, 0)];
        settle(app);

        expect(app.backend.getBgAt(new Point(gw + 4, 0))).toBe(editor.resolvedStyle.bg);
    });

    it("a textual occurrence uses the configured wordHighlightText background", () => {
        const custom = packRgb(90, 10, 10);
        const { app, editor, viewState, gw } = createEditor("foo foo");
        editor.setStyleVars({ "editor.wordHighlightTextBackground": custom });
        viewState.selections = [createCursorSelection(0, 0)];
        settle(app);

        expect(app.backend.getBgAt(new Point(gw + 0, 0))).toBe(custom);
        expect(app.backend.getBgAt(new Point(gw + 4, 0))).toBe(custom);
    });

    it("highlights nothing when the cursor rests on whitespace", () => {
        const { app, editor, viewState, gw } = createEditor("foo  foo");
        viewState.selections = [createCursorSelection(0, 4)]; // between the two spaces
        settle(app);

        expect(app.backend.getBgAt(new Point(gw + 0, 0))).toBe(editor.resolvedStyle.bg);
        expect(app.backend.getBgAt(new Point(gw + 5, 0))).toBe(editor.resolvedStyle.bg);
    });

    it("suppresses the highlight while a selection wider than a word is active", () => {
        const { app, editor, viewState, gw } = createEditor("foo bar foo");
        viewState.selections = [createSelection(0, 0, 0, 7)];
        settle(app);

        expect(app.backend.getBgAt(new Point(gw + 8, 0))).toBe(editor.resolvedStyle.bg);
    });

    it("a selection inside a word highlights that word's occurrences", () => {
        const { app, viewState, gw } = createEditor("foo bar foo");
        viewState.selections = [createSelection(0, 0, 0, 2)];
        settle(app);

        expect(app.backend.getBgAt(new Point(gw + 8, 0))).toBe(OCCURRENCE_BG);
    });

    it("paints each kind in its own color, the text under the cells unchanged", () => {
        const [read, write, text] = [packRgb(10, 0, 0), packRgb(0, 10, 0), packRgb(0, 0, 10)];
        const { app, editor, viewState, gw } = createEditor("foo bar baz qux");
        editor.setStyleVars({
            "editor.wordHighlightBackground": read,
            "editor.wordHighlightStrongBackground": write,
            "editor.wordHighlightTextBackground": text,
        });
        viewState.wordHighlights = wordHighlightSetOf([
            { range: createRange(0, 0, 0, 3), kind: DocumentHighlightKind.Read },
            { range: createRange(0, 4, 0, 7), kind: DocumentHighlightKind.Write },
            { range: createRange(0, 8, 0, 11), kind: DocumentHighlightKind.Text },
        ]);
        app.render();

        expect(app.backend.getBgAt(new Point(gw + 0, 0))).toBe(read);
        expect(app.backend.getBgAt(new Point(gw + 4, 0))).toBe(write);
        expect(app.backend.getBgAt(new Point(gw + 8, 0))).toBe(text);
        expect(app.backend.getBgAt(new Point(gw + 12, 0))).toBe(editor.resolvedStyle.bg);
    });

    it("linked ranges repaint by themselves, in their color and over the occurrences", () => {
        const [read, linked] = [packRgb(10, 0, 0), packRgb(0, 10, 0)];
        const { app, editor, viewState, gw } = createEditor("foo bar");
        editor.setStyleVars({ "editor.wordHighlightBackground": read, "editor.linkedEditingBackground": linked });
        viewState.wordHighlights = wordHighlightSetOf([
            { range: createRange(0, 0, 0, 3), kind: DocumentHighlightKind.Read },
        ]);
        app.render();
        const markDirty = vi.spyOn(editor, "markDirty");

        viewState.linkedEditingRanges = [createRange(0, 0, 0, 3)];
        expect(markDirty).toHaveBeenCalled();
        app.render();
        expect(app.backend.getBgAt(new Point(gw, 0))).toBe(linked);

        viewState.linkedEditingRanges = [];
        app.render();
        expect(app.backend.getBgAt(new Point(gw, 0))).toBe(read);
    });

    it("marks each kind on the scrollbar in its own color", () => {
        const [read, write, text] = [packRgb(10, 0, 0), packRgb(0, 10, 0), packRgb(0, 0, 10)];
        const { app, editor, viewState } = createEditor("a\nb\nc");
        editor.setStyleVars({
            "editorOverviewRuler.wordHighlightForeground": read,
            "editorOverviewRuler.wordHighlightStrongForeground": write,
            "editorOverviewRuler.wordHighlightTextForeground": text,
        });
        viewState.wordHighlights = wordHighlightSetOf([
            { range: createRange(0, 0, 0, 1), kind: DocumentHighlightKind.Read },
            { range: createRange(1, 0, 1, 1), kind: DocumentHighlightKind.Write },
            { range: createRange(2, 0, 2, 1), kind: DocumentHighlightKind.Text },
        ]);

        app.render();
        const colorByRow = new Map(editor.getScrollBarMarkers().map((marker) => [marker.start, marker.color]));
        expect(colorByRow).toEqual(
            new Map([
                [0, read],
                [1, write],
                [2, text],
            ]),
        );
    });

    it("a new set of any kind rebuilds the marks", () => {
        const { editor, viewState } = createEditor("a\nb");
        editor.setStyleVars({
            "editorOverviewRuler.wordHighlightForeground": packRgb(10, 0, 0),
            "editorOverviewRuler.wordHighlightStrongForeground": packRgb(0, 10, 0),
            "editorOverviewRuler.wordHighlightTextForeground": packRgb(0, 0, 10),
        });
        const range = createRange(0, 0, 0, 1);
        const lengths = [DocumentHighlightKind.Text, DocumentHighlightKind.Read, DocumentHighlightKind.Write].map(
            (kind) => {
                viewState.wordHighlights = wordHighlightSetOf([]);
                const before = editor.getScrollBarMarkers();
                viewState.wordHighlights = wordHighlightSetOf([{ range, kind }]);
                const after = editor.getScrollBarMarkers();
                expect(after).not.toBe(before);
                return after.length;
            },
        );
        expect(lengths).toEqual([1, 1, 1]);
    });

    it("hides the highlight in the very frame a selection appears", () => {
        const { app, editor, viewState, gw } = createEditor("foo bar foo");
        viewState.selections = [createCursorSelection(0, 0)];
        settle(app);

        viewState.selections = [createSelection(0, 0, 0, 7)];
        app.render();

        expect(app.backend.getBgAt(new Point(gw + 8, 0))).toBe(editor.resolvedStyle.bg);
    });

    it("does nothing when disabled", () => {
        const { app, editor, viewState, gw } = createEditor("foo foo");
        editor.occurrenceHighlightEnabled = false;
        viewState.selections = [createCursorSelection(0, 0)];
        settle(app);

        expect(app.backend.getBgAt(new Point(gw + 0, 0))).toBe(editor.resolvedStyle.bg);
        expect(app.backend.getBgAt(new Point(gw + 4, 0))).toBe(editor.resolvedStyle.bg);
    });

    it("drops a pending query when disabled before it runs", () => {
        const { app, editor, viewState, gw } = createEditor("foo foo");
        viewState.selections = [createCursorSelection(0, 0)];
        app.render();
        editor.occurrenceHighlightEnabled = false;
        vi.advanceTimersByTime(RUN_DELAY_MS);
        editor.occurrenceHighlightEnabled = true;
        app.render();

        expect(app.backend.getBgAt(new Point(gw + 4, 0))).toBe(editor.resolvedStyle.bg);
    });

    it("highlights again once re-enabled", () => {
        const { app, editor, gw } = createEditor("foo foo");
        editor.occurrenceHighlightEnabled = false;
        settle(app);
        editor.occurrenceHighlightEnabled = true;
        settle(app);

        expect(app.backend.getBgAt(new Point(gw + 4, 0))).toBe(OCCURRENCE_BG);
    });

    it("keeps the highlight stable across re-renders and updates it when the cursor moves", () => {
        const { app, editor, viewState, gw } = createEditor("foo bar foo");
        viewState.selections = [createCursorSelection(0, 0)];
        settle(app);
        app.render();
        expect(app.backend.getBgAt(new Point(gw + 0, 0))).toBe(OCCURRENCE_BG);

        viewState.selections = [createCursorSelection(0, 4)];
        settle(app);
        expect(app.backend.getBgAt(new Point(gw + 4, 0))).toBe(OCCURRENCE_BG);
        expect(app.backend.getBgAt(new Point(gw + 0, 0))).toBe(editor.resolvedStyle.bg);
    });

    it("keeps the set while the cursor moves within a highlighted word (upstream `_run`)", () => {
        const { app, editor, viewState } = createEditor("foo bar foo");
        editor.setStyleVars({ "editorOverviewRuler.wordHighlightTextForeground": packRgb(1, 2, 3) });
        viewState.selections = [createCursorSelection(0, 0)];
        settle(app);
        const before = editor.getScrollBarMarkers();

        viewState.selections = [createCursorSelection(0, 9)];
        settle(app);

        // The marks are rebuilt only when the occurrence set itself changes.
        expect(editor.getScrollBarMarkers()).toBe(before);
    });

    it("an edit drops the highlight and does not search the file again (upstream `_stopAll`)", () => {
        const { app, editor, viewState, gw } = createEditor("foo bar foo");
        viewState.selections = [createCursorSelection(0, 3)];
        settle(app);
        expect(app.backend.getBgAt(new Point(gw + 8, 0))).toBe(OCCURRENCE_BG);

        press(editor, "x");
        settle(app);

        // A query after the edit would highlight `foox`, the word now under the cursor.
        expect(viewState.document.getLineContent(0)).toBe("foox bar foo");
        expect(app.backend.getBgAt(new Point(gw + 0, 0))).toBe(editor.resolvedStyle.bg);
        expect(app.backend.getBgAt(new Point(gw + 9, 0))).toBe(editor.resolvedStyle.bg);
    });

    it("a cursor remapped inside the edit's own event does not query either (undo, extension edits)", () => {
        const { app, editor, viewState, gw } = createEditor("foo bar foo");
        viewState.selections = [createCursorSelection(0, 9)];
        settle(app);
        // The view state shifts the caret while the content event is still being delivered,
        // before the element hears about the edit.
        viewState.document.applyEdits([{ range: createRange(0, 0, 0, 0), text: "foo\n" }]);
        // Clamped to the end of the new first line: the caret now rests on its `foo`.
        expect(viewState.selections[0].active).toEqual({ line: 0, character: 3 });
        settle(app);

        expect(app.backend.getBgAt(new Point(gw + 0, 0))).toBe(editor.resolvedStyle.bg);
        expect(app.backend.getBgAt(new Point(gw + 0, 1))).toBe(editor.resolvedStyle.bg);
    });

    it("an explicit cursor move after an edit brings the highlight back", async () => {
        const { app, editor, viewState, gw } = createEditor("foo bar foo");
        // The element's own initial query is spent: only the move can query again.
        settle(app);
        press(editor, "x");
        // The edit's task ends: the next cursor move is the user's.
        await Promise.resolve();
        viewState.selections = [createCursorSelection(0, 6)];
        settle(app);

        expect(app.backend.getBgAt(new Point(gw + 5, 0))).toBe(OCCURRENCE_BG);
        expect(app.backend.getBgAt(new Point(gw + 0, 0))).toBe(editor.resolvedStyle.bg);
    });

    it("an edit withdraws only the query of its own task, not the one made before", async () => {
        const { app, viewState, gw } = createEditor("foo bar foo");
        settle(app);
        viewState.selections = [createCursorSelection(0, 5)];
        await Promise.resolve();
        // Away from the caret, in a later task and before the frame: the query stands.
        viewState.document.applyEdits([{ range: createRange(0, 11, 0, 11), text: " bar" }]);
        settle(app);

        expect(app.backend.getBgAt(new Point(gw + 4, 0))).toBe(OCCURRENCE_BG);
        expect(app.backend.getBgAt(new Point(gw + 12, 0))).toBe(OCCURRENCE_BG);
    });

    it("asks for a frame once the query has found the occurrences", () => {
        const { app, editor } = createEditor("foo bar foo");
        app.render();
        expect(editor.isLayoutDirty).toBe(false);

        vi.advanceTimersByTime(RUN_DELAY_MS);

        expect(editor.isLayoutDirty).toBe(true);
    });

    it("a newer query restarts the delay (upstream `runDelayer.trigger`)", () => {
        const { app, editor, viewState, gw } = createEditor("foo bar foo");
        app.render();
        vi.advanceTimersByTime(RUN_DELAY_MS - 10);
        viewState.selections = [createCursorSelection(0, 5)];
        app.render();
        vi.advanceTimersByTime(RUN_DELAY_MS - 10);
        app.render();
        expect(app.backend.getBgAt(new Point(gw + 4, 0))).toBe(editor.resolvedStyle.bg);

        vi.advanceTimersByTime(10);
        app.render();
        expect(app.backend.getBgAt(new Point(gw + 4, 0))).toBe(OCCURRENCE_BG);
    });

    it.each([
        ["start", 0],
        ["end", 3],
    ])("keeps the set with the caret at the word's %s (both ends count)", (_, character) => {
        const { app, editor, viewState } = createEditor("foo bar foo");
        editor.setStyleVars({ "editorOverviewRuler.wordHighlightTextForeground": packRgb(1, 2, 3) });
        viewState.selections = [createCursorSelection(0, 1)];
        settle(app);
        const before = editor.getScrollBarMarkers();

        viewState.selections = [createCursorSelection(0, character)];
        settle(app);

        expect(editor.getScrollBarMarkers()).toBe(before);
    });

    it("queries again with the caret past the last occurrence", () => {
        const { app, viewState, gw } = createEditor("foo bar foo baz");
        viewState.selections = [createCursorSelection(0, 1)];
        settle(app);
        viewState.selections = [createCursorSelection(0, 13)];
        settle(app);

        expect(app.backend.getBgAt(new Point(gw + 12, 0))).toBe(OCCURRENCE_BG);
        expect(app.backend.getBgAt(new Point(gw + 0, 0))).not.toBe(OCCURRENCE_BG);
    });

    it("reports whether it is enabled", () => {
        const { editor } = createEditor("foo");
        expect(editor.occurrenceHighlightEnabled).toBe(true);
        editor.occurrenceHighlightEnabled = false;
        expect(editor.occurrenceHighlightEnabled).toBe(false);
    });

    it("paints occurrences on the visible rows of a scrolled file", () => {
        const text = Array.from({ length: 1000 }, (_, i) => `foo ${i}`).join("\n");
        const { app, editor, viewState, gw } = createEditor(text, 30, 5);
        viewState.selections = [createCursorSelection(500, 0)];
        viewState.scrollTop = 498;
        settle(app);

        for (let row = 0; row < 5; row++) {
            expect(app.backend.getBgAt(new Point(gw + 0, row))).toBe(OCCURRENCE_BG);
            expect(app.backend.getBgAt(new Point(gw + 2, row))).toBe(OCCURRENCE_BG);
            expect(app.backend.getBgAt(new Point(gw + 4, row))).toBe(editor.resolvedStyle.bg);
        }
    });

    it("selection background wins over the occurrence highlight on overlap", () => {
        const SELECTION_BG = packRgb(38, 79, 120);
        const { app, viewState, gw } = createEditor("foo foo");
        // Primary collapsed cursor on "foo" plus a second selection covering the
        // second "foo" — the selection paints on top of the occurrence highlight.
        viewState.selections = [createCursorSelection(0, 0), createSelection(0, 4, 0, 7)];
        settle(app);

        expect(app.backend.getBgAt(new Point(gw + 4, 0))).toBe(SELECTION_BG);
    });
});
