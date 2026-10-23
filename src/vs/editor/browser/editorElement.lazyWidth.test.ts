import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { ScrollBarDecorator } from "@tuidom/elements/scrollbar/scrollContainerElement";
import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../TestUtils/TestApp.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement, WIDTH_SWEEP_BATCH_LINES } from "./editorElement.ts";

const ROWS = 24;
const LINE_COUNT = 1000;
const WIDE_LINE = 500;
const NARROW = "0123456789";
const WIDE = "w".repeat(120);

/** A thousand short lines with one wide line far below the first screen. */
function makeDocument(): TextDocument {
    const lines = Array.from({ length: LINE_COUNT }, (_, i) => (i === WIDE_LINE ? WIDE : NARROW));
    return new TextDocument(lines.join("\n"));
}

function setUp(withScrollBar = false): {
    app: TestApp;
    editor: EditorElement;
    doc: TextDocument;
    linesRead: () => number[];
} {
    const doc = makeDocument();
    const viewState = new EditorViewState(doc);
    const editor = new EditorElement(viewState);
    // The occurrence query would read the whole document after its delay; it is not what is measured here.
    editor.occurrenceHighlightEnabled = false;
    const getLineContent = vi.spyOn(doc, "getLineContent");
    const app = TestApp.createWithContent(withScrollBar ? new ScrollBarDecorator(editor) : editor, new Size(80, ROWS));
    app.render();
    return { app, editor, doc, linesRead: () => getLineContent.mock.calls.map((c) => c[0]) };
}

/** One `setImmediate` turn: the sweep's next slice has run by the time it resolves. */
function idleTick(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

async function settle(editor: EditorElement): Promise<void> {
    for (let i = 0; i < 100 && editor.contentWidth !== WIDE.length; i++) await idleTick();
}

describe("EditorElement — content width measured lazily", () => {
    it("the frame measures only the lines it shows", () => {
        const { editor, linesRead } = setUp();
        expect(editor.contentWidth).toBe(NARROW.length);
        expect(Math.max(...linesRead())).toBeLessThan(ROWS);
    });

    it("an idle slice measures a bounded batch below the viewport, one slice however often the width is read", async () => {
        const { editor, linesRead } = setUp();
        expect(editor.contentWidth).toBe(NARROW.length);
        expect(editor.contentWidth).toBe(NARROW.length);

        await idleTick();

        expect(Math.max(...linesRead())).toBe(ROWS + WIDTH_SWEEP_BATCH_LINES - 1);
        expect(editor.contentWidth).toBe(NARROW.length);
        // Nothing wider turned up: no frame for it.
        expect(editor.isLayoutDirty).toBe(false);
    });

    it("once the file is measured, neither a frame nor a slice schedules anything", async () => {
        const { editor } = setUp();
        await settle(editor);
        for (let i = 0; i < 20; i++) await idleTick();

        const setImmediateSpy = vi.spyOn(globalThis, "setImmediate");
        try {
            expect(editor.contentWidth).toBe(WIDE.length);
            expect(editor.contentWidth).toBe(WIDE.length);
            await idleTick();
            await idleTick();
            // Only the two ticks of this test itself.
            expect(setImmediateSpy).toHaveBeenCalledTimes(2);
        } finally {
            setImmediateSpy.mockRestore();
        }
    });

    it("a tab size change re-measures with the new tab stops", () => {
        const doc = new TextDocument("\tx\n" + NARROW);
        const editor = new EditorElement(new EditorViewState(doc));
        editor.occurrenceHighlightEnabled = false;
        TestApp.createWithContent(editor, new Size(80, ROWS)).render();
        editor.tabSize = 4;
        expect(editor.contentWidth).toBe(NARROW.length);

        editor.tabSize = 16;
        expect(editor.contentWidth).toBe(17);
    });

    it("the sweep reaches the wide line and asks for a frame that shows the horizontal scrollbar", async () => {
        const { app, editor } = setUp(true);
        expect(editor.contentWidth).toBe(NARROW.length);
        expect(app.backend.getTextAt(new Point(0, ROWS - 1), 1)).not.toBe("▄");

        await settle(editor);

        expect(editor.contentWidth).toBe(WIDE.length);
        expect(editor.isLayoutDirty).toBe(true);
        app.render();
        expect(app.backend.getTextAt(new Point(0, ROWS - 1), 1)).toBe("▄");
    });

    it("the sweep stops once the file is measured", async () => {
        const { editor, linesRead } = setUp();
        await settle(editor);
        for (let i = 0; i < 20; i++) await idleTick();
        expect(new Set(linesRead()).size).toBe(LINE_COUNT);

        const before = linesRead().length;
        await idleTick();
        await idleTick();
        expect(linesRead().length).toBe(before);
    });

    it("a detached editor pauses the sweep; attaching it again resumes", async () => {
        const { app, editor, linesRead } = setUp();
        expect(editor.contentWidth).toBe(NARROW.length);

        const other = new EditorElement(new EditorViewState(new TextDocument("")));
        app.root.setContent(other);
        expect(editor.isConnected).toBe(false);
        const detachedAt = linesRead().length;
        for (let i = 0; i < 20; i++) await idleTick();
        expect(linesRead().length).toBe(detachedAt);

        app.root.setContent(editor);
        await settle(editor);
        expect(editor.contentWidth).toBe(WIDE.length);
    });

    it("an edit re-measures the touched line on the next frame, not the file", async () => {
        const { app, editor, doc, linesRead } = setUp();
        await settle(editor);
        const measured = linesRead().length;

        editor.viewState.type("x");
        app.render();

        // The visible rows, nothing from below the screen.
        expect(Math.max(...linesRead().slice(measured))).toBeLessThan(ROWS);
        expect(editor.contentWidth).toBe(WIDE.length);
        expect(doc.getLineContent(0)).toBe("x" + NARROW);
    });

    it("under wrap the sweep keeps measuring but a wider line is no new frame", async () => {
        const { app, editor, linesRead } = setUp();
        expect(editor.contentWidth).toBe(NARROW.length);
        editor.viewState.wordWrap = "on";
        app.render();
        const viewportWidth = editor.contentWidth;
        expect(viewportWidth).toBe(editor.viewState.viewportWidth);

        for (let i = 0; i < 100 && new Set(linesRead()).size < LINE_COUNT; i++) await idleTick();

        expect(new Set(linesRead()).size).toBe(LINE_COUNT);
        expect(editor.isLayoutDirty).toBe(false);
        expect(editor.contentWidth).toBe(viewportWidth);
        editor.viewState.wordWrap = "off";
        expect(editor.contentWidth).toBe(WIDE.length);
    });

    it("scrolling the wide line into view widens the content on that frame", () => {
        const { app, editor } = setUp();
        expect(editor.contentWidth).toBe(NARROW.length);

        editor.viewState.scrollTop = WIDE_LINE - 5;
        app.render();

        expect(editor.contentWidth).toBe(WIDE.length);
    });
});
