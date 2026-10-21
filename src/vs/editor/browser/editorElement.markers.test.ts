import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../TestUtils/TestApp.ts";
import { MarkerSeverity } from "../../platform/markers/common/iMarker.ts";
import { createRange } from "../common/core/iRange.ts";
import { createCursorSelection } from "../common/core/iSelection.ts";
import { createTextEdit } from "../common/core/iTextEdit.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";
import { computeIndentationFolds } from "../contrib/folding/foldingRangeProvider.ts";

import { EditorElement } from "./editorElement.ts";

function makeEditor(content: string): EditorElement {
    const doc = new TextDocument(content);
    const viewState = new EditorViewState(doc);
    const editor = new EditorElement(viewState);
    editor.occurrenceHighlightEnabled = false; // isolate the squiggle pass from word highlighting
    return editor;
}

const WARNING_FG = packRgb(1, 2, 3);

describe("EditorElement — marker squiggle decorations", () => {
    it("paints the severity foreground over the marker range only", () => {
        const editor = makeEditor("abcdef");
        editor.setStyleVars({ "editorWarning.foreground": WARNING_FG });
        editor.markerDecorations = [{ range: createRange(0, 0, 0, 3), severity: MarkerSeverity.Warning }];

        const app = TestApp.createWithContent(editor, new Size(40, 4));
        app.render();

        const gw = editor.gutterWidth;
        expect(app.backend.getFgAt(new Point(gw + 0, 0))).toBe(WARNING_FG);
        expect(app.backend.getFgAt(new Point(gw + 2, 0))).toBe(WARNING_FG);
        expect(app.backend.getFgAt(new Point(gw + 3, 0))).toBe(editor.resolvedStyle.fg);
    });

    it("maps each severity to its configured colour", () => {
        const cases = [
            { severity: MarkerSeverity.Error, token: "editorError.foreground", color: packRgb(200, 0, 0) },
            { severity: MarkerSeverity.Warning, token: "editorWarning.foreground", color: packRgb(200, 160, 0) },
            { severity: MarkerSeverity.Info, token: "editorInfo.foreground", color: packRgb(0, 120, 255) },
            { severity: MarkerSeverity.Hint, token: "editorHint.foreground", color: packRgb(180, 180, 180) },
        ];
        for (const { severity, token, color } of cases) {
            const editor = makeEditor("abcdef");
            editor.setStyleVars({ [token]: color });
            editor.markerDecorations = [{ range: createRange(0, 0, 0, 2), severity }];
            const app = TestApp.createWithContent(editor, new Size(40, 4));
            app.render();
            expect(app.backend.getFgAt(new Point(editor.gutterWidth, 0))).toBe(color);
        }
    });

    it("falls back to the built-in colours when the theme has not set them", () => {
        // Every severity foreground left undefined → the VS Code dark defaults.
        const fallbacks = [
            { severity: MarkerSeverity.Error, color: packRgb(0xf1, 0x4c, 0x4c) },
            { severity: MarkerSeverity.Warning, color: packRgb(0xcc, 0xa7, 0x00) },
            { severity: MarkerSeverity.Info, color: packRgb(0x37, 0x94, 0xff) },
            { severity: MarkerSeverity.Hint, color: packRgb(0xee, 0xee, 0xee) },
        ];
        for (const { severity, color } of fallbacks) {
            const editor = makeEditor("abcdef");
            editor.markerDecorations = [{ range: createRange(0, 0, 0, 2), severity }];
            const app = TestApp.createWithContent(editor, new Size(40, 4));
            app.render();
            expect(app.backend.getFgAt(new Point(editor.gutterWidth, 0))).toBe(color);
        }
    });
});

// Dogfooding: until the provider's new diagnostics arrived, the squiggle stayed at old coordinates and
// underlined unrelated text. In upstream markers are model decorations and move with the edit at once.
describe("EditorElement — squiggle moves with text on edit", () => {
    const ERROR_FG = packRgb(0xf1, 0x4c, 0x4c); // default editorError.foreground

    function makeTracked(content: string): { app: TestApp; editor: EditorElement } {
        const editor = makeEditor(content);
        editor.markerDecorations = [{ range: createRange(1, 4, 1, 7), severity: MarkerSeverity.Error }];
        const app = TestApp.createWithContent(editor, new Size(40, 6));
        app.render();
        return { app, editor };
    }

    function squiggledText(app: TestApp, editor: EditorElement, screenY: number): string {
        let text = "";
        for (let x = editor.gutterWidth; x < 40; x++) {
            const cell = app.app.screen.getCell(new Point(x, screenY));
            if ((cell.style & StyleFlags.Undercurl) !== 0) text += cell.char;
        }
        return text;
    }

    function type(editor: EditorElement, line: number, character: number, keys: string): void {
        editor.viewState.selections = [createCursorSelection(line, character)];
        for (const key of keys) editor.dispatchEvent(new TUIKeyboardEvent("keypress", { key }));
    }

    it("typing to the left on the same line shifts the squiggle right", () => {
        const { app, editor } = makeTracked("ok\nlet bad = 1;");
        type(editor, 1, 0, "xx");
        app.render();
        expect(squiggledText(app, editor, 1)).toBe("bad");
        expect(app.backend.getFgAt(new Point(editor.gutterWidth + 6, 1))).toBe(ERROR_FG);
    });

    it("inserting a line above moves the squiggle one line down", () => {
        const { app, editor } = makeTracked("ok\nlet bad = 1;");
        editor.viewState.selections = [createCursorSelection(0, 2)];
        editor.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "Enter" }));
        app.render();
        expect(squiggledText(app, editor, 1)).toBe("");
        expect(squiggledText(app, editor, 2)).toBe("bad");
    });

    it("typing at an edge does not grow the squiggle (NeverGrowsWhenTypingAtEdges)", () => {
        const { app, editor } = makeTracked("ok\nlet bad = 1;");
        type(editor, 1, 7, "X");
        type(editor, 1, 4, "Y");
        app.render();
        expect(editor.viewState.document.getLineContent(1)).toBe("let YbadX = 1;");
        expect(squiggledText(app, editor, 1)).toBe("bad");
    });

    it("typing inside the range extends the squiggle over the inserted text", () => {
        const { app, editor } = makeTracked("ok\nlet bad = 1;");
        type(editor, 1, 5, "zz");
        app.render();
        expect(squiggledText(app, editor, 1)).toBe("bzzad");
    });

    it("deleting the whole range removes the squiggle", () => {
        const { app, editor } = makeTracked("ok\nlet bad = 1;");
        editor.viewState.document.applyEdits([createTextEdit(createRange(1, 4, 1, 7), "")]);
        app.render();
        expect(squiggledText(app, editor, 1)).toBe("");
    });

    it("new provider markers replace the shifted ones", () => {
        const { app, editor } = makeTracked("ok\nlet bad = 1;");
        type(editor, 1, 0, "xx");
        editor.markerDecorations = [{ range: createRange(1, 0, 1, 2), severity: MarkerSeverity.Error }];
        app.render();
        expect(squiggledText(app, editor, 1)).toBe("xx");
    });
});

// A file with an error on every line painted folding guides red: the squiggle set
// fg on indent cells with the `│` glyph too. In VS Code the guide is a separate layer.
describe("EditorElement — squiggle over indentation guides", () => {
    // Nested regions: line 2 (`        return 1;`) has TWO guides — from the outer
    // function (column 0) and from `if` (column 4).
    const SAMPLE = ["function foo() {", "    if (ready) {", "        return 1;", "    }", "}"].join("\n");
    const ERROR_FG = packRgb(0xf1, 0x4c, 0x4c); // default editorError.foreground
    // The cursor is on line 0: only the outer region encloses it, so the
    // column 0 guide is active and the nested one (column 4) is regular.
    const ACTIVE_GUIDE_FG = packRgb(0x70, 0x70, 0x70); // editorIndentGuide.activeBackground1
    const GUIDE_FG = packRgb(0x40, 0x40, 0x40); // editorIndentGuide.background1

    /** Editor with indent-based folding and an error over the whole block (lines 0..3). */
    function makeFoldedEditor(): { app: TestApp; editor: EditorElement } {
        const doc = new TextDocument(SAMPLE);
        const viewState = new EditorViewState(doc);
        viewState.setFoldingRegions(computeIndentationFolds(doc, viewState.tabSize));
        const editor = new EditorElement(viewState);
        editor.occurrenceHighlightEnabled = false;
        editor.markerDecorations = [{ range: createRange(0, 0, 3, 5), severity: MarkerSeverity.Error }];
        const app = TestApp.createWithContent(editor, new Size(40, 6));
        app.render();
        return { app, editor };
    }

    it("keeps every guide glyph and colour on the marker's whitespace cells", () => {
        const { app, editor } = makeFoldedEditor();
        const gw = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gw, 2), 1)).toBe("│");
        expect(app.backend.getFgAt(new Point(gw, 2))).toBe(ACTIVE_GUIDE_FG);
        expect(app.backend.getTextAt(new Point(gw + 4, 2), 1)).toBe("│");
        expect(app.backend.getFgAt(new Point(gw + 4, 2))).toBe(GUIDE_FG);
    });

    it("still marks the guide cells with an undercurl", () => {
        const { app, editor } = makeFoldedEditor();
        const gw = editor.gutterWidth;
        expect(app.app.screen.getCell(new Point(gw, 2)).style & StyleFlags.Undercurl).toBe(StyleFlags.Undercurl);
        expect(app.app.screen.getCell(new Point(gw + 4, 2)).style & StyleFlags.Undercurl).toBe(StyleFlags.Undercurl);
    });

    it("still paints the severity colour on the range's text cells", () => {
        const { app, editor } = makeFoldedEditor();
        const gw = editor.gutterWidth;
        // "return" on line 2 starts at column 8: a regular text cell.
        expect(app.backend.getTextAt(new Point(gw + 8, 2), 1)).toBe("r");
        expect(app.backend.getFgAt(new Point(gw + 8, 2))).toBe(ERROR_FG);
        expect(app.app.screen.getCell(new Point(gw + 8, 2)).style & StyleFlags.Undercurl).toBe(StyleFlags.Undercurl);
    });

    it("paints the severity colour on whitespace that carries no guide", () => {
        const { app, editor } = makeFoldedEditor();
        const gw = editor.gutterWidth;
        // Column 1 of line 2 has the same indent but no guide: error color.
        expect(app.backend.getTextAt(new Point(gw + 1, 2), 1)).toBe(" ");
        expect(app.backend.getFgAt(new Point(gw + 1, 2))).toBe(ERROR_FG);
    });
});
