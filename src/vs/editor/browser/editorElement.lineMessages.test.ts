import { compositeOver, packRgb, packRgba } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../TestUtils/TestApp.ts";
import { createRange } from "../common/core/iRange.ts";
import { createCursorSelection } from "../common/core/iSelection.ts";
import { createTextEdit } from "../common/core/iTextEdit.ts";
import type { ILineMessageDecoration } from "../common/model/iLineMessageDecoration.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";
import { LONG_LINE_TRUNCATION_BADGE, STOP_RENDERING_LINE_AFTER } from "../common/viewModel/longLineRendering.ts";
import { createFoldingRegion } from "../contrib/folding/iFoldingRegion.ts";

import { EditorElement } from "./editorElement.ts";

const EDITOR_BG = packRgb(0x1e, 0x1e, 0x1e);
const BADGE_FG = packRgb(0x33, 0x33, 0x33);
const BADGE_BG = packRgb(0xf1, 0x4c, 0x4c);
const INFO_FG = packRgba(0xff, 0xff, 0xff, 0x80);
const DIFF_BG = packRgb(0x20, 0x40, 0x20);

const LINES = "describe\n  it a\n  it b\nend";

function setup(text = LINES, size = new Size(30, 6)) {
    const editor = new EditorElement(new EditorViewState(new TextDocument(text)));
    editor.occurrenceHighlightEnabled = false;
    editor.setStyleVars({
        "editor.background": EDITOR_BG,
        "testing.message.error.badgeForeground": BADGE_FG,
        "testing.message.error.badgeBackground": BADGE_BG,
        "testing.message.info.decorationForeground": INFO_FG,
        "diff.added": DIFF_BG,
    });
    editor.style = { bg: "editor.background" };
    const app = TestApp.createWithContent(editor, size);
    const clicks: string[] = [];
    editor.onDidClickLineMessage((key) => clicks.push(key));
    const row = (y: number): string => {
        app.render();
        return app.backend.getTextAt(new Point(0, y), size.width).trimEnd();
    };
    const mouseDown = (x: number, y: number): void => {
        app.render();
        editor.dispatchEvent(
            new TUIMouseEvent("mousedown", { button: "left", screenX: x, screenY: y, localX: x, localY: y }),
        );
    };
    return { app, editor, clicks, row, mouseDown };
}

function error(key: string, line: number, text = "✗ boom"): ILineMessageDecoration {
    return {
        key,
        line,
        text,
        colorToken: "testing.message.error.badgeForeground",
        bgToken: "testing.message.error.badgeBackground",
    };
}

describe("EditorElement — messages after the lines' ends", () => {
    it("is drawn two cells after the line's end in its colors, the gap in the editor's background", () => {
        const { app, editor, row } = setup();
        editor.setLineMessageDecorations([error("a", 1)]);
        const textStart = editor.gutterWidth;

        expect(row(1).slice(textStart)).toBe("  it a  ✗ boom");
        const messageStart = textStart + "  it a".length + 2;
        expect(app.backend.getFgAt(new Point(messageStart, 1))).toBe(BADGE_FG);
        expect(app.backend.getBgAt(new Point(messageStart, 1))).toBe(BADGE_BG);
        expect(app.backend.getBgAt(new Point(messageStart + 5, 1))).toBe(BADGE_BG);
        expect(app.backend.getBgAt(new Point(messageStart - 1, 1))).toBe(EDITOR_BG);
        expect(app.backend.getBgAt(new Point(messageStart + 6, 1))).toBe(EDITOR_BG);
        expect(row(0).slice(textStart)).toBe("describe");
    });

    it("a translucent color is blended over the background; no background token keeps the editor's", () => {
        const { app, editor, row } = setup();
        editor.setLineMessageDecorations([
            { key: "log", line: 0, text: "log", colorToken: "testing.message.info.decorationForeground" },
        ]);
        expect(row(0).slice(editor.gutterWidth)).toBe("describe  log");
        const x = editor.gutterWidth + "describe".length + 2;
        expect(app.backend.getFgAt(new Point(x, 0))).toBe(compositeOver(INFO_FG, EDITOR_BG));
        expect(app.backend.getBgAt(new Point(x, 0))).toBe(EDITOR_BG);
    });

    it("lies on the line's decorated background where it has none of its own", () => {
        const { app, editor } = setup();
        editor.decorations = { lineBackgrounds: [{ startLine: 0, endLine: 0, colorToken: "diff.added" }] };
        editor.setLineMessageDecorations([
            { key: "log", line: 0, text: "log", colorToken: "testing.message.info.decorationForeground" },
        ]);
        app.render();
        expect(app.backend.getBgAt(new Point(editor.gutterWidth + "describe".length + 2, 0))).toBe(DIFF_BG);
    });

    it("is cut by the editor's right edge and does not wrap", () => {
        const { editor, row } = setup(LINES, new Size(20, 6));
        editor.setLineMessageDecorations([error("a", 1, "✗ a long message that does not fit")]);
        expect(row(1).slice(editor.gutterWidth)).toBe("  it a  ✗ a lo");
        expect(row(2).slice(editor.gutterWidth)).toBe("  it b");
    });

    it("scrolled to the right, shows the part of it right of the left edge", () => {
        const { editor, row } = setup();
        editor.viewState.scrollLeft = 10;
        editor.setLineMessageDecorations([error("a", 0, "0123456789")]);
        // "describe" ends at column 8, the message starts at 10: scrolled by 10 it starts at the edge; by 12 cut.
        expect(row(0).slice(editor.gutterWidth)).toBe("0123456789");
        editor.viewState.scrollLeft = 12;
        editor.markDirty();
        expect(row(0).slice(editor.gutterWidth)).toBe("23456789");
        editor.viewState.scrollLeft = 30;
        editor.markDirty();
        expect(row(0).slice(editor.gutterWidth)).toBe("");
    });

    it("on a wrapped line goes after the last fragment, not after the first", () => {
        const { editor, row } = setup(`${"x".repeat(30)}\nend`, new Size(24, 6));
        editor.viewState.wordWrap = "on";
        editor.setLineMessageDecorations([error("a", 0, "msg")]);
        row(0);
        const width = 24 - editor.gutterWidth;
        expect(row(0).slice(editor.gutterWidth)).toBe("x".repeat(width));
        expect(row(1).slice(editor.gutterWidth)).toBe(`${"x".repeat(30 - width)}  msg`);
    });

    it("on a trimmed long line goes after the trim badge", () => {
        const { editor, row } = setup(`${"x".repeat(STOP_RENDERING_LINE_AFTER + 1)}\nend`, new Size(40, 6));
        editor.viewState.scrollLeft = STOP_RENDERING_LINE_AFTER - 2;
        editor.setLineMessageDecorations([error("a", 0, "msg")]);
        expect(row(0).slice(editor.gutterWidth)).toBe(`xx${LONG_LINE_TRUNCATION_BADGE}  msg`);
    });

    it("on a folded region's header goes after the fold marker", () => {
        const { editor, row } = setup();
        editor.viewState.setFoldingRegions([createFoldingRegion(0, 2)]);
        editor.viewState.toggleFold(0);
        editor.setLineMessageDecorations([error("a", 0, "msg")]);
        expect(row(0).slice(editor.gutterWidth)).toBe("describe ⋯  msg");
    });

    it("rides its line through edits; a deleted line's message is gone", () => {
        const { editor, row } = setup();
        editor.setLineMessageDecorations([error("a", 1, "msg"), error("b", 2, "other")]);
        editor.viewState.document.applyEdits([createTextEdit(createRange(0, 0, 0, 0), "top\n")]);
        expect(row(2).slice(editor.gutterWidth)).toBe("  it a  msg");
        expect([...editor.getLineMessageDecorations().keys()]).toEqual([2, 3]);

        // Typing on the line keeps it after the new end.
        editor.viewState.document.applyEdits([createTextEdit(createRange(2, 6, 2, 6), "bc")]);
        expect(row(2).slice(editor.gutterWidth)).toBe("  it abc  msg");

        editor.viewState.document.applyEdits([createTextEdit(createRange(2, 0, 3, 0), "")]);
        expect(row(2).slice(editor.gutterWidth)).toBe("  it b  other");
        expect([...editor.getLineMessageDecorations().values()].map((message) => message.key)).toEqual(["b"]);
    });

    it("set again without it, it goes", () => {
        const { editor, row } = setup();
        editor.setLineMessageDecorations([error("a", 1, "msg")]);
        expect(row(1).slice(editor.gutterWidth)).toBe("  it a  msg");
        editor.setLineMessageDecorations([]);
        expect(row(1).slice(editor.gutterWidth)).toBe("  it a");
    });

    describe("clicks", () => {
        it("a left press on its cells fires its key and leaves the cursor", () => {
            const { editor, clicks, mouseDown } = setup();
            editor.viewState.selections = [createCursorSelection(3, 1)];
            editor.setLineMessageDecorations([error("a", 1, "msg"), error("b", 2, "other")]);
            const start = editor.gutterWidth + "  it a".length + 2;

            mouseDown(start, 1);
            mouseDown(start + 2, 1);
            mouseDown(editor.gutterWidth + "  it b".length + 2 + 4, 2);

            expect(clicks).toEqual(["a", "a", "b"]);
            expect(editor.viewState.selections).toEqual([createCursorSelection(3, 1)]);
        });

        it("the gap, the cell after it and another row place the cursor as before", () => {
            const { editor, clicks, mouseDown } = setup();
            editor.setLineMessageDecorations([error("a", 1, "msg")]);
            const start = editor.gutterWidth + "  it a".length + 2;

            mouseDown(start - 1, 1);
            expect(editor.viewState.selections[0].active).toEqual({ line: 1, character: 6 });
            mouseDown(start + 3, 1);
            mouseDown(start, 0);
            expect(editor.viewState.selections[0].active).toEqual({ line: 0, character: 8 });
            expect(clicks).toEqual([]);
        });

        it("the part cut by the right edge is not there to click", () => {
            const { editor, clicks, mouseDown } = setup(LINES, new Size(20, 6));
            editor.setLineMessageDecorations([error("a", 1, "✗ a long message that does not fit")]);
            mouseDown(19, 1);
            expect(clicks).toEqual(["a"]);
            mouseDown(20, 1);
            expect(clicks).toEqual(["a"]);
        });

        it("a message scrolled out of view is not clicked", () => {
            const { editor, clicks, mouseDown } = setup();
            editor.setLineMessageDecorations([error("a", 0, "msg")]);
            editor.viewState.scrollLeft = 30;
            editor.markDirty();
            mouseDown(editor.gutterWidth, 0);
            expect(clicks).toEqual([]);
        });
    });
});
