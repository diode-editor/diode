import { describe, expect, it, vi } from "vitest";

import {
    LONG_LINE_TRUNCATION_BADGE_WIDTH,
    STOP_RENDERING_LINE_AFTER,
} from "../../../../../tuidom/common/textLimits.ts";
import { createInsertEdit } from "../core/iTextEdit.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

describe("EditorViewState.hasLinesOverRenderCap", () => {
    it("is false for a document of normal lines", () => {
        const vs = new EditorViewState(new TextDocument("short\nlines\nhere"));
        expect(vs.hasLinesOverRenderCap()).toBe(false);
    });

    it("is false for a line exactly at the cap", () => {
        const vs = new EditorViewState(new TextDocument("a".repeat(STOP_RENDERING_LINE_AFTER)));
        expect(vs.hasLinesOverRenderCap()).toBe(false);
    });

    it("is true once a line exceeds the cap", () => {
        const vs = new EditorViewState(new TextDocument("a".repeat(STOP_RENDERING_LINE_AFTER + 1)));
        expect(vs.hasLinesOverRenderCap()).toBe(true);
    });

    it("detects a long line among normal ones", () => {
        const doc = new TextDocument(["one", "two", "x".repeat(STOP_RENDERING_LINE_AFTER + 100), "four"].join("\n"));
        expect(new EditorViewState(doc).hasLinesOverRenderCap()).toBe(true);
    });

    it("caches by versionId (no rescan without an edit)", () => {
        const doc = new TextDocument("short");
        const vs = new EditorViewState(doc);
        expect(vs.hasLinesOverRenderCap()).toBe(false);

        const getLineLength = vi.spyOn(doc, "getLineLength");
        vs.hasLinesOverRenderCap();
        vs.hasLinesOverRenderCap();
        expect(getLineLength).not.toHaveBeenCalled();
    });

    it("flips to true when a long line is appended (Output pattern)", () => {
        const doc = new TextDocument("first log line");
        const vs = new EditorViewState(doc);
        expect(vs.hasLinesOverRenderCap()).toBe(false);

        doc.applyEdits([createInsertEdit(0, 14, "\n" + "b".repeat(STOP_RENDERING_LINE_AFTER + 5))]);
        expect(vs.hasLinesOverRenderCap()).toBe(true);
    });
});

describe("EditorViewState — revealing the end of a truncated line", () => {
    const VIEWPORT_WIDTH = 80;

    it("scrolls the whole [truncation] badge into view at the line end", () => {
        const doc = new TextDocument("x".repeat(STOP_RENDERING_LINE_AFTER + 500));
        const vs = new EditorViewState(doc);
        vs.viewportWidth = VIEWPORT_WIDTH;
        vs.viewportHeight = 10;

        const displayWidth = vs.displayLineFor(doc.getLineContent(0)).displayWidth; // == cap
        vs.cursorEnd();

        // The badge occupies [displayWidth, displayWidth + badgeWidth). All of it
        // must be inside the viewport, not clipped at the right edge.
        const badgeStart = displayWidth - vs.scrollLeft;
        const badgeEnd = displayWidth + LONG_LINE_TRUNCATION_BADGE_WIDTH - 1 - vs.scrollLeft;
        expect(badgeStart).toBeGreaterThanOrEqual(0);
        expect(badgeEnd).toBeLessThan(VIEWPORT_WIDTH);
        // Exactly enough to show the badge's last cell at the right edge.
        expect(vs.scrollLeft).toBe(displayWidth + LONG_LINE_TRUNCATION_BADGE_WIDTH - VIEWPORT_WIDTH);
    });

    it("does not over-scroll for a normal (non-truncated) line end", () => {
        const doc = new TextDocument("y".repeat(200));
        const vs = new EditorViewState(doc);
        vs.viewportWidth = VIEWPORT_WIDTH;
        vs.viewportHeight = 10;

        vs.cursorEnd();
        // Cursor at column 200 revealed at the right edge — no badge extension.
        expect(vs.scrollLeft).toBe(200 - VIEWPORT_WIDTH + 1);
    });
});
