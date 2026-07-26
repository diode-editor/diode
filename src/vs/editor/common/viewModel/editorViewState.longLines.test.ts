import { describe, expect, it } from "vitest";

import {
    LONG_LINE_TRUNCATION_BADGE_WIDTH,
    STOP_RENDERING_LINE_AFTER,
} from "../../../../../tuidom/common/textLimits.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

describe("EditorViewState — revealing the end of a truncated line", () => {
    const VIEWPORT_WIDTH = 80;

    it("scrolls the whole truncation button into view at the line end", () => {
        const doc = new TextDocument("x".repeat(STOP_RENDERING_LINE_AFTER + 500));
        const vs = new EditorViewState(doc);
        vs.viewportWidth = VIEWPORT_WIDTH;
        vs.viewportHeight = 10;

        const displayWidth = vs.displayLineFor(doc.getLineContent(0)).displayWidth; // == cap
        vs.cursorEnd();

        // The button occupies [displayWidth, displayWidth + badgeWidth). All of it
        // must be inside the viewport, not clipped at the right edge.
        const buttonStart = displayWidth - vs.scrollLeft;
        const buttonEnd = displayWidth + LONG_LINE_TRUNCATION_BADGE_WIDTH - 1 - vs.scrollLeft;
        expect(buttonStart).toBeGreaterThanOrEqual(0);
        expect(buttonEnd).toBeLessThan(VIEWPORT_WIDTH);
        // Exactly enough to show the button's last cell at the right edge.
        expect(vs.scrollLeft).toBe(displayWidth + LONG_LINE_TRUNCATION_BADGE_WIDTH - VIEWPORT_WIDTH);
    });

    it("does not over-scroll for a normal (non-truncated) line end", () => {
        const doc = new TextDocument("y".repeat(200));
        const vs = new EditorViewState(doc);
        vs.viewportWidth = VIEWPORT_WIDTH;
        vs.viewportHeight = 10;

        vs.cursorEnd();
        // Cursor at column 200 revealed at the right edge — no button extension.
        expect(vs.scrollLeft).toBe(200 - VIEWPORT_WIDTH + 1);
    });
});
