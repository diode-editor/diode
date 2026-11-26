import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIContextMenuEvent, TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { PaddingContainerElement } from "@tuidom/elements/layout/paddingContainerElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../TestUtils/TestApp.ts";
import { createRange } from "../common/core/iRange.ts";
import { createCursorSelection } from "../common/core/iSelection.ts";
import { createTextEdit } from "../common/core/iTextEdit.ts";
import type { IGlyphMarginClick, IGlyphMarginDecoration } from "../common/model/iGlyphMarginDecoration.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";
import { createFoldingRegion } from "../contrib/folding/iFoldingRegion.ts";

import { EditorElement } from "./editorElement.ts";

const RUN_FG = packRgb(0x73, 0xc9, 0x91);
const FAILED_FG = packRgb(0xf8, 0x80, 0x70);
const RULER_ERROR = packRgb(250, 0, 0);

function setup(
    text: string,
    size = new Size(30, 8),
): { app: TestApp; editor: EditorElement; clicks: IGlyphMarginClick[] } {
    const editor = new EditorElement(new EditorViewState(new TextDocument(text)));
    editor.occurrenceHighlightEnabled = false;
    editor.setStyleVars({
        "testing.runAction": RUN_FG,
        "testing.iconFailed": FAILED_FG,
        "editorOverviewRuler.errorForeground": RULER_ERROR,
    });
    const app = TestApp.createWithContent(editor, size);
    const clicks: IGlyphMarginClick[] = [];
    editor.onDidClickGlyphMargin((click) => clicks.push(click));
    return { app, editor, clicks };
}

function glyph(key: string, line: number, extra: Partial<IGlyphMarginDecoration> = {}): IGlyphMarginDecoration {
    return { key, line, glyph: "▷", colorToken: "testing.runAction", ...extra };
}

function mouseDown(
    editor: EditorElement,
    x: number,
    y: number,
    {
        button = "left",
        shiftKey = false,
        altKey = false,
    }: Partial<Pick<IGlyphMarginClick, "button" | "shiftKey" | "altKey">> = {},
): void {
    editor.dispatchEvent(
        new TUIMouseEvent("mousedown", { button, shiftKey, altKey, screenX: x, screenY: y, localX: x, localY: y }),
    );
}

function click(
    fields: Partial<IGlyphMarginClick> & Pick<IGlyphMarginClick, "line" | "screenX" | "screenY">,
): IGlyphMarginClick {
    return { button: "left", shiftKey: false, altKey: false, ...fields };
}

function rightClick(app: TestApp, editor: EditorElement, x: number, y: number): void {
    const token = (action: MouseToken["action"]): MouseToken => ({
        kind: "mouse",
        button: "right",
        action,
        x: editor.globalPosition.x + x + 1,
        y: editor.globalPosition.y + y + 1,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
    });
    app.backend.simulateMouse(token("press"));
    app.backend.simulateMouse(token("release"));
}

const LINES = "describe\n  it a\n  it b\nend";

describe("EditorElement — glyph margin", () => {
    it("without glyphs the gutter keeps two columns of padding before the line number", () => {
        const { app, editor } = setup(LINES);
        app.render();
        expect(editor.gutterWidth).toBe(6);
        expect(app.backend.getTextAt(new Point(0, 0), 3)).toBe("  1");
    });

    it("a glyph widens the padding to three columns and is drawn in the middle one with its color", () => {
        const { app, editor } = setup(LINES);
        editor.setGlyphMarginDecorations("t", [
            glyph("a", 1),
            glyph("b", 2, { glyph: "⊗", colorToken: "testing.iconFailed" }),
        ]);
        app.render();

        expect(editor.gutterWidth).toBe(7);
        expect(app.backend.getTextAt(new Point(0, 0), 4)).toBe("   1");
        expect(app.backend.getTextAt(new Point(0, 1), 4)).toBe(" ▷ 2");
        expect(app.backend.getTextAt(new Point(0, 2), 4)).toBe(" ⊗ 3");
        expect(app.backend.getFgAt(new Point(1, 1))).toBe(RUN_FG);
        expect(app.backend.getFgAt(new Point(1, 2))).toBe(FAILED_FG);
        expect(app.backend.getTextAt(new Point(editor.gutterWidth, 1), 4)).toBe("  it");
    });

    it("clearing the glyphs gives the gutter its width back", () => {
        const { app, editor } = setup(LINES);
        editor.setGlyphMarginDecorations("t", [glyph("a", 1)]);
        app.render();
        editor.setGlyphMarginDecorations("t", []);
        app.render();
        expect(editor.gutterWidth).toBe(6);
        expect(app.backend.getTextAt(new Point(0, 1), 3)).toBe("  2");
    });

    it("a glyph past the end of the document is on its last line", () => {
        const { app, editor } = setup(LINES);
        editor.setGlyphMarginDecorations("t", [glyph("far", 40)]);
        app.render();
        expect(app.backend.getTextAt(new Point(0, 3), 4)).toBe(" ▷ 4");
    });

    it("is not repeated on a wrapped continuation row", () => {
        const { app, editor, clicks } = setup(`  it ${"x".repeat(40)}\n  it b`, new Size(20, 6));
        editor.viewState.wordWrap = "on";
        editor.setGlyphMarginDecorations("t", [glyph("a", 0), glyph("b", 1)]);
        app.render();
        app.render();
        expect(app.backend.getTextAt(new Point(0, 0), 3)).toBe(" ▷ ");
        expect(app.backend.getTextAt(new Point(0, 1), 3)).toBe("   ");

        mouseDown(editor, 1, 1);
        expect(editor.viewState.selections[0].active.line).toBe(0);
        expect(clicks).toEqual([]);
    });

    describe("clicks", () => {
        it.each([0, 1, 2])(
            "a left press on padding column %i of a glyph's line fires the click and leaves the cursor",
            (x) => {
                const { app, editor, clicks } = setup(LINES);
                editor.viewState.selections = [createCursorSelection(3, 2)];
                editor.setGlyphMarginDecorations("t", [glyph("a", 1)]);
                app.render();

                mouseDown(editor, x, 1);

                expect(clicks).toEqual([click({ line: 1, owner: "t", key: "a", screenX: x, screenY: 1 })]);
                expect(editor.viewState.selections).toEqual([createCursorSelection(3, 2)]);
            },
        );

        it("the line number column and the rows past the end place the cursor as before", () => {
            const { app, editor, clicks } = setup(LINES);
            editor.setGlyphMarginDecorations("t", [glyph("a", 1)]);
            app.render();

            mouseDown(editor, 3, 1);
            expect(editor.viewState.selections[0].active.line).toBe(1);
            mouseDown(editor, 1, 6);
            expect(editor.viewState.selections[0].active.line).toBe(3);
            expect(clicks).toEqual([]);
        });

        it("a press on the lane of a line without a glyph fires a click without one and leaves the cursor", () => {
            const { app, editor, clicks } = setup(LINES);
            editor.viewState.selections = [createCursorSelection(3, 2)];
            editor.setGlyphMarginDecorations("t", [glyph("a", 1)]);
            app.render();

            mouseDown(editor, 1, 2, { shiftKey: true, altKey: true });

            expect(clicks).toEqual([click({ line: 2, shiftKey: true, altKey: true, screenX: 1, screenY: 2 })]);
            expect(editor.viewState.selections).toEqual([createCursorSelection(3, 2)]);
        });

        it("a reserved lane is there without glyphs, and its presses are clicks; unreserved, the padding is text again", () => {
            const { app, editor, clicks } = setup(LINES);
            editor.glyphMarginReserved = true;
            app.render();
            expect(editor.gutterWidth).toBe(7);
            expect(editor.glyphMarginReserved).toBe(true);

            mouseDown(editor, 0, 1);
            expect(clicks).toEqual([click({ line: 1, screenX: 0, screenY: 1 })]);
            expect(editor.viewState.selections[0].active.line).toBe(0);

            editor.glyphMarginReserved = false;
            app.render();
            expect(editor.gutterWidth).toBe(6);
            mouseDown(editor, 0, 1);
            expect(clicks).toHaveLength(1);
            expect(editor.viewState.selections[0].active.line).toBe(1);
        });

        it("reserved or not after a frame, the next frame moves the text", () => {
            const { app, editor } = setup(LINES);
            app.render();
            expect(app.backend.getTextAt(new Point(0, 1), 9)).toBe("  2     i");
            editor.glyphMarginReserved = true;
            app.render();
            expect(app.backend.getTextAt(new Point(0, 1), 9)).toBe("   2     ");
        });

        it("a press on the lane focuses the editor, as a press on its text does", () => {
            const { app, editor } = setup(LINES);
            editor.glyphMarginReserved = true;
            app.render();
            expect(editor.isFocused).toBe(false);
            mouseDown(editor, 0, 1);
            expect(editor.isFocused).toBe(true);
        });

        it("a middle press on the lane is a click of the middle button; elsewhere it does nothing", () => {
            const { app, editor, clicks } = setup(LINES);
            editor.setGlyphMarginDecorations("t", [glyph("a", 1)]);
            app.render();

            mouseDown(editor, 1, 1, { button: "middle" });
            mouseDown(editor, 8, 2, { button: "middle" });

            expect(clicks).toEqual([
                click({ line: 1, owner: "t", key: "a", button: "middle", screenX: 1, screenY: 1 }),
            ]);
            expect(editor.viewState.selections[0].active.line).toBe(0);
        });

        it("a press on a fold header's glyph runs the glyph and leaves the region open", () => {
            const { app, editor, clicks } = setup(LINES);
            editor.viewState.setFoldingRegions([createFoldingRegion(0, 2)]);
            editor.setGlyphMarginDecorations("t", [glyph("suite", 0)]);
            app.render();

            mouseDown(editor, 1, 0);

            expect(clicks.map((click) => click.key)).toEqual(["suite"]);
            expect(editor.viewState.getViewLineCount()).toBe(4);
        });

        it("a right click on a glyph fires it with the right button instead of the editor's context menu", () => {
            const { app, editor, clicks } = setup(LINES);
            editor.viewState.selections = [createCursorSelection(3, 2)];
            editor.setGlyphMarginDecorations("t", [glyph("a", 1)]);
            app.render();
            let editorMenu = false;
            editor.getParent()?.addEventListener("contextmenu", (event) => {
                editorMenu = !event.defaultPrevented;
            });

            rightClick(app, editor, 1, 1);

            expect(clicks).toEqual([click({ line: 1, owner: "t", key: "a", button: "right", screenX: 1, screenY: 1 })]);
            expect(editorMenu).toBe(false);
            expect(editor.viewState.selections).toEqual([createCursorSelection(3, 2)]);
        });

        it("a right click elsewhere and a keyboard context menu stay the editor's", () => {
            const { app, editor, clicks } = setup(LINES);
            editor.setGlyphMarginDecorations("t", [glyph("a", 1)]);
            app.render();
            const prevented: boolean[] = [];
            editor.getParent()?.addEventListener("contextmenu", (event) => {
                prevented.push(event.defaultPrevented);
            });

            rightClick(app, editor, 4, 2);
            editor.dispatchEvent(
                new TUIContextMenuEvent({
                    trigger: "keyboard",
                    button: "none",
                    screenX: 1,
                    screenY: 1,
                    localX: 1,
                    localY: 1,
                }),
            );

            expect(clicks).toEqual([]);
            expect(prevented).toEqual([false, false]);
        });

        it("an editor away from the screen's corner takes the press from its own cells", () => {
            const editor = new EditorElement(new EditorViewState(new TextDocument(LINES)));
            editor.occurrenceHighlightEnabled = false;
            const app = TestApp.createWithContent(
                new PaddingContainerElement(editor, { left: 5, top: 2 }),
                new Size(40, 10),
            );
            const clicks: IGlyphMarginClick[] = [];
            editor.onDidClickGlyphMargin((click) => clicks.push(click));
            editor.setGlyphMarginDecorations("t", [glyph("a", 1)]);
            app.render();

            for (const action of ["press", "release"] as const) {
                app.backend.simulateMouse({
                    kind: "mouse",
                    button: "left",
                    action,
                    x: 5 + 1 + 1,
                    y: 2 + 1 + 1,
                    shiftKey: false,
                    altKey: false,
                    ctrlKey: false,
                    raw: "",
                });
            }

            expect(clicks).toEqual([click({ line: 1, owner: "t", key: "a", screenX: 6, screenY: 3 })]);
        });

        it("the rows past the end are no glyph of the last line", () => {
            const { app, editor, clicks } = setup(LINES);
            editor.setGlyphMarginDecorations("t", [glyph("end", 3)]);
            app.render();

            mouseDown(editor, 1, 4);
            mouseDown(editor, 1, 5);
            expect(clicks).toEqual([]);
            mouseDown(editor, 1, 3);
            expect(clicks.map((click) => click.key)).toEqual(["end"]);
        });

        it("a view zone row under a glyph's line is no glyph", () => {
            const { app, editor, clicks } = setup(LINES);
            editor.viewState.setViewZones([{ afterLine: 1, size: 1 }]);
            editor.setGlyphMarginDecorations("t", [glyph("a", 1), glyph("b", 2)]);
            app.render();

            mouseDown(editor, 1, 2);
            mouseDown(editor, 1, 3);

            expect(clicks.map((click) => click.key)).toEqual(["b"]);
        });
    });

    describe("edits", () => {
        it("a line inserted above moves the glyph down with its line", () => {
            const { app, editor, clicks } = setup(LINES);
            editor.setGlyphMarginDecorations("t", [glyph("a", 1)]);
            editor.viewState.document.applyEdits([createTextEdit(createRange(0, 0, 0, 0), "// top\n")]);
            app.render();

            expect(app.backend.getTextAt(new Point(0, 1), 4)).toBe("   2");
            expect(app.backend.getTextAt(new Point(0, 2), 4)).toBe(" ▷ 3");
            mouseDown(editor, 1, 2);
            expect(clicks.map((click) => click.key)).toEqual(["a"]);
        });

        it("set again with the same key and line, a glyph keeps the line it moved to; a new line places it there", () => {
            const { app, editor } = setup(LINES);
            editor.setGlyphMarginDecorations("t", [glyph("a", 1)]);
            editor.viewState.document.applyEdits([createTextEdit(createRange(0, 0, 0, 0), "// top\n")]);
            editor.setGlyphMarginDecorations("t", [glyph("a", 1, { glyph: "⊗" })]);
            app.render();
            expect(app.backend.getTextAt(new Point(0, 2), 4)).toBe(" ⊗ 3");

            editor.setGlyphMarginDecorations("t", [glyph("a", 3, { glyph: "⊗" })]);
            app.render();
            expect(app.backend.getTextAt(new Point(0, 2), 4)).toBe("   3");
            expect(app.backend.getTextAt(new Point(0, 3), 4)).toBe(" ⊗ 4");
        });

        it("deleting the glyph's line removes the glyph; typing on it does not", () => {
            const { app, editor, clicks } = setup(LINES);
            editor.setGlyphMarginDecorations("t", [glyph("a", 1), glyph("b", 2)]);
            const document = editor.viewState.document;
            document.applyEdits([createTextEdit(createRange(2, 4, 2, 4), "!")]);
            document.applyEdits([createTextEdit(createRange(1, 0, 2, 0), "")]);
            app.render();

            expect(app.backend.getTextAt(new Point(0, 1), 4)).toBe(" ▷ 2");
            expect(app.backend.getTextAt(new Point(0, 2), 4)).toBe("   3");
            mouseDown(editor, 1, 1);
            expect(clicks.map((click) => click.key)).toEqual(["b"]);
        });

        it("the last line keeps its glyph when it is the one typed on", () => {
            const { app, editor } = setup(LINES);
            editor.setGlyphMarginDecorations("t", [glyph("end", 3)]);
            editor.viewState.document.applyEdits([createTextEdit(createRange(3, 3, 3, 3), "!")]);
            app.render();
            expect(app.backend.getTextAt(new Point(0, 3), 4)).toBe(" ▷ 4");
        });

        it("an empty last line keeps its glyph", () => {
            const { app, editor } = setup("it\n");
            editor.setGlyphMarginDecorations("t", [glyph("empty", 1)]);
            app.render();
            expect(app.backend.getTextAt(new Point(0, 1), 4)).toBe(" ▷ 2");
        });
    });

    describe("owners", () => {
        it("of two owners' glyphs on a line the higher zIndex is drawn and clicked; a tie goes to the first owner", () => {
            const { app, editor, clicks } = setup(LINES);
            editor.setGlyphMarginDecorations("testing", [glyph("test", 1), glyph("other", 2)]);
            editor.setGlyphMarginDecorations("debug", [
                glyph("bp", 1, { glyph: "●", zIndex: 9999 }),
                glyph("tie", 2, { glyph: "○" }),
            ]);
            app.render();

            expect(app.backend.getTextAt(new Point(0, 1), 4)).toBe(" ● 2");
            expect(app.backend.getTextAt(new Point(0, 2), 4)).toBe(" ▷ 3");
            mouseDown(editor, 1, 1);
            mouseDown(editor, 1, 2);
            expect(clicks.map(({ owner, key }) => `${String(owner)}:${String(key)}`)).toEqual([
                "debug:bp",
                "testing:other",
            ]);
        });

        it("a glyph's own color is drawn instead of its token's", () => {
            const { app, editor } = setup("a\nb");
            const ICON = packRgb(0xe5, 0x14, 0x00);
            editor.setGlyphMarginDecorations("ext:1", [glyph("1", 1, { glyph: "●", color: ICON })]);
            app.render();

            expect(app.backend.getTextAt(new Point(1, 1), 1)).toBe("●");
            expect(app.backend.getFgAt(new Point(1, 1))).toBe(ICON);
        });

        it("an owner clearing its glyphs leaves the other owner's; the lane goes with the last glyph", () => {
            const { app, editor } = setup(LINES);
            editor.setGlyphMarginDecorations("testing", [glyph("test", 1)]);
            editor.setGlyphMarginDecorations("debug", [glyph("bp", 1, { glyph: "●", zIndex: 1 })]);
            editor.setGlyphMarginDecorations("debug", []);
            app.render();
            expect(app.backend.getTextAt(new Point(0, 1), 4)).toBe(" ▷ 2");

            editor.setGlyphMarginDecorations("testing", []);
            app.render();
            expect(editor.gutterWidth).toBe(6);
        });

        it("every owner's glyph marks the ruler, the hidden one too", () => {
            const { app, editor } = setup(LINES);
            editor.setGlyphMarginDecorations("testing", [
                glyph("test", 1, { overviewRulerColorToken: "editorOverviewRuler.errorForeground" }),
            ]);
            editor.setGlyphMarginDecorations("debug", [
                glyph("bp", 1, { zIndex: 1, overviewRulerColorToken: "testing.runAction" }),
            ]);
            app.render();
            expect(editor.getScrollBarMarkers()).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ start: 1, end: 2, color: RULER_ERROR }),
                    expect.objectContaining({ start: 1, end: 2, color: RUN_FG }),
                ]),
            );
        });
    });

    it("a glyph with a ruler color marks its line in the scrollbar", () => {
        const { app, editor } = setup(LINES);
        editor.setGlyphMarginDecorations("t", [
            glyph("a", 1),
            glyph("b", 2, { overviewRulerColorToken: "editorOverviewRuler.errorForeground" }),
        ]);
        app.render();
        expect(editor.getScrollBarMarkers()).toEqual([
            expect.objectContaining({ start: 2, end: 3, color: RULER_ERROR }),
        ]);
    });
});
