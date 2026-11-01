import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../TestUtils/TestApp.ts";
import { MarkerSeverity } from "../../platform/markers/common/iMarker.ts";
import { createRange } from "../common/core/iRange.ts";
import { createCursorSelection } from "../common/core/iSelection.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";
import { SemanticTokenIndex } from "./tokenIndex.ts";

const ACTIVE_FG = packRgb(9, 8, 7);
const LINK = createRange(0, 2, 0, 6);

interface IMouse {
    readonly ctrl?: boolean;
}

function setup(text = "a link b\nsecond", size = new Size(40, 6)) {
    const viewState = new EditorViewState(new TextDocument(text));
    const editor = new EditorElement(viewState);
    editor.occurrenceHighlightEnabled = false;
    editor.setStyleVars({ "editorLink.activeForeground": ACTIVE_FG });
    editor.setDocumentLinks([LINK]);
    const app = TestApp.createWithContent(editor, new Size(size.width, size.height));
    app.render();
    const gw = editor.gutterWidth;
    const clicks = vi.fn();
    editor.onDidClickDocumentLink(clicks);
    const send = (
        kind: "mousedown" | "mouseup" | "mousemove" | "mouseleave",
        x: number,
        y: number,
        mouse: IMouse = {},
    ): void => {
        editor.dispatchEvent(
            new TUIMouseEvent(kind, {
                button: kind === "mousemove" || kind === "mouseleave" ? "none" : "left",
                screenX: x,
                screenY: y,
                localX: x,
                localY: y,
                ctrlKey: mouse.ctrl === true,
            }),
        );
    };
    const underlined = (x: number, y = 0): boolean => {
        app.render();
        return (app.app.screen.getCell(new Point(x, y)).style & StyleFlags.Underline) !== 0;
    };
    const fgAt = (x: number, y = 0): number | undefined => {
        app.render();
        return app.backend.getFgAt(new Point(x, y));
    };
    return { app, editor, viewState, gw, clicks, send, underlined, fgAt };
}

describe("EditorElement — document links", () => {
    describe("the underline", () => {
        it("lies on the cells of the link only", () => {
            const { gw, underlined } = setup();
            expect(underlined(gw + 1)).toBe(false);
            expect(underlined(gw + 2)).toBe(true);
            expect(underlined(gw + 5)).toBe(true);
            expect(underlined(gw + 6)).toBe(false);
            expect(underlined(gw + 2, 1)).toBe(false);
        });

        it("keeps the color of the text and goes with the links", () => {
            const { editor, gw, underlined, fgAt } = setup();
            expect(fgAt(gw + 3)).toBe(fgAt(gw));
            editor.setDocumentLinks([]);
            expect(underlined(gw + 3)).toBe(false);
        });

        it("joins the flags the token set instead of replacing them", () => {
            const { app, gw, viewState } = setup();
            const bold = { styleAt: () => ({ bold: true }) };
            vi.spyOn(viewState, "getViewLineSemanticTokens").mockReturnValue({} as never);
            vi.spyOn(SemanticTokenIndex.prototype, "styleAt").mockImplementation(bold.styleAt as never);
            viewState.selections = [createCursorSelection(1, 0)];
            app.render();
            const style = app.app.screen.getCell(new Point(gw + 3, 0)).style;
            expect(style & StyleFlags.Underline).toBe(StyleFlags.Underline);
            expect(style & StyleFlags.Bold).toBe(StyleFlags.Bold);
            vi.restoreAllMocks();
        });

        it("a squiggle over a link wins", () => {
            const { app, editor, gw } = setup();
            editor.setStyleVars({ "editorError.foreground": packRgb(1, 1, 1) });
            editor.markerDecorations = [{ range: LINK, severity: MarkerSeverity.Error }];
            app.render();
            expect(app.app.screen.getCell(new Point(gw + 3, 0)).style).toBe(StyleFlags.Undercurl);
        });

        it("only visible links are painted, after a scroll too", () => {
            const lines = Array.from({ length: 30 }, (_, i) => `line ${String(i)} word`).join("\n");
            const { editor, viewState, gw, underlined } = setup(lines, new Size(40, 4));
            editor.setDocumentLinks([createRange(0, 0, 0, 4), createRange(20, 0, 20, 4)]);
            expect(underlined(gw)).toBe(true);
            viewState.scrollTop = 20;
            editor.markDirty();
            expect(underlined(gw)).toBe(true);
            viewState.scrollTop = 10;
            editor.markDirty();
            expect(underlined(gw)).toBe(false);
        });
    });

    describe("Ctrl+click", () => {
        it("press and release on one link fire with its start; the caret stays", () => {
            const { viewState, gw, clicks, send } = setup();
            viewState.selections = [createCursorSelection(1, 1)];
            send("mousedown", gw + 3, 0, { ctrl: true });
            expect(clicks).not.toHaveBeenCalled();
            send("mouseup", gw + 5, 0);
            expect(clicks.mock.calls).toEqual([[LINK.start]]);
            expect(viewState.selections).toEqual([createCursorSelection(1, 1)]);
        });

        it("a press does not start a selection drag", () => {
            const { viewState, gw, send } = setup();
            viewState.selections = [createCursorSelection(1, 1)];
            send("mousedown", gw + 3, 0, { ctrl: true });
            send("mousemove", gw + 5, 1, { ctrl: true });
            expect(viewState.selections).toEqual([createCursorSelection(1, 1)]);
        });

        it("a release off the link does nothing, and neither does the next release", () => {
            const { gw, clicks, send } = setup();
            send("mousedown", gw + 3, 0, { ctrl: true });
            send("mouseup", gw + 6, 0);
            send("mouseup", gw + 3, 0);
            expect(clicks).not.toHaveBeenCalled();
        });

        it("a click without Ctrl is a plain click", () => {
            const { viewState, gw, clicks, send } = setup();
            send("mousedown", gw + 3, 0);
            send("mouseup", gw + 3, 0);
            expect(clicks).not.toHaveBeenCalled();
            expect(viewState.selections).toEqual([createCursorSelection(0, 3)]);
        });

        it("Ctrl+click off a link is a plain click: the caret moves", () => {
            const { viewState, gw, clicks, send } = setup();
            send("mousedown", gw + 7, 0, { ctrl: true });
            send("mouseup", gw + 7, 0);
            expect(clicks).not.toHaveBeenCalled();
            expect(viewState.selections).toEqual([createCursorSelection(0, 7)]);
        });

        it("the cell right after a link, and past the end of its line, are not on it", () => {
            const { editor, gw, clicks, send } = setup();
            editor.setDocumentLinks([createRange(0, 4, 0, 8)]);
            send("mousedown", gw + 8, 0, { ctrl: true });
            send("mouseup", gw + 8, 0);
            send("mousedown", gw + 20, 0, { ctrl: true });
            send("mouseup", gw + 20, 0);
            expect(clicks).not.toHaveBeenCalled();
        });

        it("the gutter is not on a link starting at column 0", () => {
            const { editor, clicks, send } = setup();
            editor.setDocumentLinks([createRange(0, 0, 0, 4)]);
            send("mousedown", 0, 0, { ctrl: true });
            send("mouseup", 0, 0);
            expect(clicks).not.toHaveBeenCalled();
        });

        it("the space below the document is not on the last line's link", () => {
            const { editor, gw, clicks, send } = setup();
            editor.setDocumentLinks([createRange(1, 0, 1, 6)]);
            send("mousedown", gw + 2, 4, { ctrl: true });
            send("mouseup", gw + 2, 4);
            expect(clicks).not.toHaveBeenCalled();
        });

        it("a view zone row is not on the link of the line next to it", () => {
            const { editor, gw, clicks, send, viewState } = setup();
            editor.setDocumentLinks([createRange(1, 0, 1, 6)]);
            vi.spyOn(viewState, "viewLineKind").mockReturnValue("zone");
            send("mousedown", gw + 2, 1, { ctrl: true });
            send("mouseup", gw + 2, 1);
            expect(clicks).not.toHaveBeenCalled();
        });

        it("the pointer leaving the editor cancels the press", () => {
            const { gw, clicks, send } = setup();
            send("mousedown", gw + 3, 0, { ctrl: true });
            send("mouseleave", gw + 3, 0);
            send("mouseup", gw + 3, 0);
            expect(clicks).not.toHaveBeenCalled();
        });

        it("new links cancel the press", () => {
            const { editor, gw, clicks, send } = setup();
            send("mousedown", gw + 3, 0, { ctrl: true });
            editor.setDocumentLinks([createRange(0, 2, 0, 6)]);
            send("mouseup", gw + 3, 0);
            expect(clicks).not.toHaveBeenCalled();
        });
    });

    describe("the active link", () => {
        it("takes its color under the pointer with Ctrl, and only there", () => {
            const { editor, gw, send, fgAt } = setup();
            editor.setDocumentLinks([LINK, createRange(1, 0, 1, 6)]);
            const plain = fgAt(gw + 3);
            send("mousemove", gw + 3, 0, { ctrl: true });
            expect(fgAt(gw + 3)).toBe(ACTIVE_FG);
            expect(fgAt(gw + 2)).toBe(ACTIVE_FG);
            expect(fgAt(gw + 1)).toBe(plain);
            expect(fgAt(gw, 1)).toBe(plain);
        });

        it("goes when Ctrl is off the move, the pointer moves off, or leaves", () => {
            const { gw, send, fgAt } = setup();
            const plain = fgAt(gw + 3);
            send("mousemove", gw + 3, 0, { ctrl: true });
            send("mousemove", gw + 3, 0);
            expect(fgAt(gw + 3)).toBe(plain);

            send("mousemove", gw + 3, 0, { ctrl: true });
            send("mousemove", gw + 7, 0, { ctrl: true });
            expect(fgAt(gw + 3)).toBe(plain);

            send("mousemove", gw + 3, 0, { ctrl: true });
            send("mouseleave", gw + 3, 0);
            expect(fgAt(gw + 3)).toBe(plain);
        });

        it("goes with new links, which may be elsewhere", () => {
            const { editor, gw, send, fgAt } = setup();
            const plain = fgAt(gw + 3);
            send("mousemove", gw + 3, 0, { ctrl: true });
            editor.setDocumentLinks([createRange(0, 2, 0, 6)]);
            expect(fgAt(gw + 3)).toBe(plain);
        });
    });
});
