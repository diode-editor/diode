import { describe, expect, it } from "vitest";

import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";
import { createFoldingRegion } from "../contrib/folding/iFoldingRegion.ts";

import { EditorElement } from "./editorElement.ts";

// Expanded fold chevrons only show while the mouse is over the gutter (à la VS
// Code `editor.showFoldingControls: "mouseover"`); collapsed ones always show.

const CHEVRON_EXPANDED = ""; //  nf-cod-chevron_down
const CHEVRON_COLLAPSED = ""; //  nf-cod-chevron_right

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

function fireMouseMove(editor: EditorElement, localX: number, localY: number): void {
    editor.dispatchEvent(
        new TUIMouseEvent("mousemove", { button: "none", screenX: localX, screenY: localY, localX, localY }),
    );
}

function fireMouseLeave(editor: EditorElement): void {
    editor.dispatchEvent(
        new TUIMouseEvent("mouseleave", { button: "none", screenX: 0, screenY: 0, localX: 0, localY: 0 }),
    );
}

function chevronAt(app: TestApp, editor: EditorElement, row: number): string {
    return app.backend.getTextAt(new Point(editor.foldControlColumn, row), 1);
}

describe("EditorElement – fold chevron hover reveal", () => {
    // Two expanded headers on lines 0 and 3 of an 8-line document.
    const twoRegions = "a\n  b\n  c\nd\n  e\n  f\ng\nh";

    it("hides expanded chevrons at rest (no hover)", () => {
        const { app, editor } = createEditor(twoRegions, [
            { start: 0, end: 2 },
            { start: 3, end: 5 },
        ]);
        app.render();
        expect(chevronAt(app, editor, 0)).toBe(" ");
        expect(chevronAt(app, editor, 3)).toBe(" ");
    });

    it("keeps a collapsed chevron visible at rest", () => {
        const { app, editor } = createEditor(twoRegions, [{ start: 0, end: 2, collapsed: true }]);
        app.render();
        expect(chevronAt(app, editor, 0)).toBe(CHEVRON_COLLAPSED);
    });

    it("reveals every expanded chevron once the gutter is hovered", () => {
        const { app, editor } = createEditor(twoRegions, [
            { start: 0, end: 2 },
            { start: 3, end: 5 },
        ]);
        // Hover an arbitrary gutter cell — reveal is not per-row.
        fireMouseMove(editor, 0, 5);
        app.render();
        expect(chevronAt(app, editor, 0)).toBe(CHEVRON_EXPANDED);
        expect(chevronAt(app, editor, 3)).toBe(CHEVRON_EXPANDED);
    });

    it("hides expanded chevrons again when the mouse moves onto the text", () => {
        const { app, editor } = createEditor(twoRegions, [{ start: 0, end: 2 }]);
        fireMouseMove(editor, editor.foldControlColumn, 0);
        app.render();
        expect(chevronAt(app, editor, 0)).toBe(CHEVRON_EXPANDED);

        // localX at/after the gutter width is over the content, not the gutter.
        fireMouseMove(editor, editor.gutterWidth, 0);
        app.render();
        expect(chevronAt(app, editor, 0)).toBe(" ");
    });

    it("hides expanded chevrons when the mouse leaves the editor", () => {
        const { app, editor } = createEditor(twoRegions, [{ start: 0, end: 2 }]);
        fireMouseMove(editor, 0, 0);
        app.render();
        expect(chevronAt(app, editor, 0)).toBe(CHEVRON_EXPANDED);

        fireMouseLeave(editor);
        app.render();
        expect(chevronAt(app, editor, 0)).toBe(" ");
    });

    it("keeps the collapsed chevron regardless of hover", () => {
        const { app, editor } = createEditor(twoRegions, [{ start: 0, end: 2, collapsed: true }]);
        fireMouseMove(editor, 0, 0);
        app.render();
        expect(chevronAt(app, editor, 0)).toBe(CHEVRON_COLLAPSED);

        fireMouseLeave(editor);
        app.render();
        expect(chevronAt(app, editor, 0)).toBe(CHEVRON_COLLAPSED);
    });
});
