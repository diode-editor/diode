import { describe, expect, it } from "vitest";

import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";
import { createFoldingRegion } from "../contrib/folding/iFoldingRegion.ts";

import { EditorElement } from "./editorElement.ts";

const CHEVRON_EXPANDED = "\ueab4"; //  nf-cod-chevron_down
const CHEVRON_COLLAPSED = "\ueab6"; //  nf-cod-chevron_right
const COLLAPSED_MARKER = "⋯";

function createEditor(
    text: string,
    regions: { start: number; end: number; collapsed?: boolean }[] = [],
    width = 20,
    height = 6,
): { app: TestApp; editor: EditorElement } {
    const doc = new TextDocument(text);
    const viewState = new EditorViewState(doc);
    viewState.setFoldingRegions(regions.map((r) => createFoldingRegion(r.start, r.end, r.collapsed)));
    const editor = new EditorElement(viewState);
    const app = TestApp.createWithContent(editor, new Size(width, height));
    return { app, editor };
}

function fireMouseDown(editor: EditorElement, localX: number, localY: number): void {
    editor.dispatchEvent(
        new TUIMouseEvent("mousedown", {
            button: "left",
            screenX: localX,
            screenY: localY,
            localX,
            localY,
        }),
    );
}

function fireMouseMove(editor: EditorElement, localX: number, localY: number): void {
    editor.dispatchEvent(
        new TUIMouseEvent("mousemove", {
            button: "none",
            screenX: localX,
            screenY: localY,
            localX,
            localY,
        }),
    );
}

describe("EditorElement – folding gutter", () => {
    it("draws a down chevron on an expanded region header while the gutter is hovered", () => {
        const { app, editor } = createEditor("a\n  b\n  c\nd", [{ start: 0, end: 2 }]);
        fireMouseMove(editor, editor.foldControlColumn, 0);
        app.render();
        expect(app.backend.getTextAt(new Point(editor.foldControlColumn, 0), 1)).toBe(CHEVRON_EXPANDED);
    });

    it("draws a right chevron on a collapsed region header", () => {
        const { app, editor } = createEditor("a\n  b\n  c\nd", [{ start: 0, end: 2, collapsed: true }]);
        app.render();
        expect(app.backend.getTextAt(new Point(editor.foldControlColumn, 0), 1)).toBe(CHEVRON_COLLAPSED);
    });

    it("leaves a blank separator on non-foldable lines", () => {
        const { app, editor } = createEditor("a\n  b\n  c\nd", [{ start: 0, end: 2 }]);
        app.render();
        // Line 3 ("d") is not a header.
        expect(app.backend.getTextAt(new Point(editor.foldControlColumn, 3), 1)).toBe(" ");
    });

    it("draws the collapsed marker after the header content and hides the body", () => {
        const { app, editor } = createEditor("a\n  b\n  c\nd", [{ start: 0, end: 2, collapsed: true }]);
        app.render();
        const gw = editor.gutterWidth;
        // "a" occupies one column; marker sits one column further (gap of 1).
        expect(app.backend.getTextAt(new Point(gw + 2, 0), 1)).toBe(COLLAPSED_MARKER);
        // Row 1 now shows the next visible logical line ("d"), body lines hidden.
        expect(app.backend.getTextAt(new Point(gw, 1), 1)).toBe("d");
    });

    it("does not draw the collapsed marker while expanded", () => {
        const { app, editor } = createEditor("a\n  b\n  c\nd", [{ start: 0, end: 2 }]);
        app.render();
        const gw = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gw + 2, 0), 1)).not.toBe(COLLAPSED_MARKER);
    });

    it("omits the collapsed marker when it would fall outside the viewport", () => {
        // Header wider than the content area → marker column is off-screen.
        const { app, editor } = createEditor("aaaaaaaaaa\n  b\n  c\nd", [{ start: 0, end: 2, collapsed: true }], 12, 6);
        app.render();
        const gw = editor.gutterWidth;
        for (let x = gw; x < 12; x++) {
            expect(app.backend.getTextAt(new Point(x, 0), 1)).not.toBe(COLLAPSED_MARKER);
        }
    });

    it("never overwrites the header's last character with the marker", () => {
        // The marker sits one column PAST the header, so no character is hidden by
        // it (the user's Tab-pushes-last-char worry does not manifest here).
        const { app, editor } = createEditor("abc\n  x\n  y\nz", [{ start: 0, end: 2, collapsed: true }]);
        app.render();
        const gw = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gw, 0), 3)).toBe("abc"); // full header
        expect(app.backend.getTextAt(new Point(gw + 4, 0), 1)).toBe(COLLAPSED_MARKER); // gap+marker after "abc"
    });

    it("shifts the collapsed marker by the horizontal scroll offset", () => {
        const { app, editor } = createEditor("abcdef\n  x\n  y\nz", [{ start: 0, end: 2, collapsed: true }], 24, 6);
        editor.viewState.scrollLeft = 2;
        app.render();
        const gw = editor.gutterWidth;
        // Header "abcdef" (width 6) → marker at displayWidth+1-scrollLeft = 5 past gutter.
        expect(app.backend.getTextAt(new Point(gw + 5, 0), 1)).toBe(COLLAPSED_MARKER);
        // Header content is scrolled, not clipped by the marker: "cdef" is visible.
        expect(app.backend.getTextAt(new Point(gw, 0), 4)).toBe("cdef");
    });
});

describe("EditorElement – folding mouse toggle", () => {
    it("toggles a region when its gutter chevron is clicked", () => {
        const { editor } = createEditor("a\n  b\n  c\nd", [{ start: 0, end: 2 }]);
        expect(editor.viewState.foldedRegions[0].isCollapsed).toBe(false);

        fireMouseDown(editor, editor.foldControlColumn, 0);
        expect(editor.viewState.foldedRegions[0].isCollapsed).toBe(true);

        fireMouseDown(editor, editor.foldControlColumn, 0);
        expect(editor.viewState.foldedRegions[0].isCollapsed).toBe(false);
    });

    it("does not move the cursor when toggling via the gutter", () => {
        const { editor } = createEditor("a\n  b\n  c\nd", [{ start: 0, end: 2 }]);
        fireMouseDown(editor, editor.foldControlColumn, 0);
        const sel = editor.viewState.selections[0];
        expect(sel.active).toEqual({ line: 0, character: 0 });
    });

    it("places the cursor normally when the gutter column is not a header", () => {
        const { editor } = createEditor("a\n  b\n  c\nd", [{ start: 0, end: 2 }]);
        // Row 3 ("d") is not a header — clicking the fold column falls back to cursor placement.
        fireMouseDown(editor, editor.foldControlColumn, 3);
        expect(editor.viewState.foldedRegions[0].isCollapsed).toBe(false);
        expect(editor.viewState.selections[0].active.line).toBe(3);
    });

    it("ignores a fold-column click below the last line", () => {
        const { editor } = createEditor("a\n  b\n  c\nd", [{ start: 0, end: 2 }], 20, 8);
        // Row 6 is past the 4-line document — no region toggles, no throw.
        fireMouseDown(editor, editor.foldControlColumn, 6);
        expect(editor.viewState.foldedRegions[0].isCollapsed).toBe(false);
    });
});
