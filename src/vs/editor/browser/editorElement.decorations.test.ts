import { compositeOver, packRgb, packRgba } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../TestUtils/TestApp.ts";
import type { IExternalDecorations } from "../common/model/iEditorDecoration.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

const REMOVED_BG = packRgb(0x4b, 0x18, 0x18);
const REMOVED_TEXT_BG = packRgb(0x66, 0x22, 0x22);
const FILLER_FG = packRgb(0x41, 0x41, 0x41);
const BG = packRgb(0x1e, 0x1e, 0x1e);

/** Translucent line background, as stock themes ship it (Catppuccin: `#a6e3a11a`). */
const TRANSLUCENT_BG = packRgba(0xa6, 0xe3, 0xa1, 0x1a);

const STYLE_VARS = {
    "editor.background": BG,
    "diffEditor.insertedLineBackground": TRANSLUCENT_BG,
    "diffEditor.removedLineBackground": REMOVED_BG,
    "diffEditor.removedTextBackground": REMOVED_TEXT_BG,
    "diffEditor.diagonalFill": FILLER_FG,
    "diffEditor.unchangedRegionForeground": packRgb(0x8c, 0x8c, 0x8c),
};

function createEditor(
    text: string,
    decorations: IExternalDecorations,
    zones: { afterLine: number; size: number }[] = [],
): { app: TestApp; editor: EditorElement } {
    const viewState = new EditorViewState(new TextDocument(text));
    viewState.setViewZones(zones);
    const editor = new EditorElement(viewState);
    editor.setStyleVars(STYLE_VARS);
    // The editor's own background, as in the app: the base for decorations with
    // alpha; without it compositing over DEFAULT_COLOR would drop the alpha.
    editor.style = { bg: "editor.background" };
    editor.decorations = decorations;
    const app = TestApp.createWithContent(editor, new Size(24, 6));
    app.render();
    return { app, editor };
}

describe("EditorElement — external decorations", () => {
    it("line background paints content and gutter, beating the token background", () => {
        const { app, editor } = createEditor("alpha\nremoved\ncharlie", {
            lineBackgrounds: [{ startLine: 1, endLine: 1, colorToken: "diffEditor.removedLineBackground" }],
        });

        expect(app.backend.getBgAt(new Point(0, 1))).toBe(REMOVED_BG); // gutter
        expect(app.backend.getBgAt(new Point(editor.gutterWidth + 2, 1))).toBe(REMOVED_BG);
        expect(app.backend.getBgAt(new Point(0, 0))).not.toBe(REMOVED_BG);
    });

    it("range background (intra-line) over the line background", () => {
        const { app, editor } = createEditor("alpha\nremoved line\ncharlie", {
            lineBackgrounds: [{ startLine: 1, endLine: 1, colorToken: "diffEditor.removedLineBackground" }],
            rangeBackgrounds: [
                {
                    range: { start: { line: 1, character: 0 }, end: { line: 1, character: 7 } },
                    colorToken: "diffEditor.removedTextBackground",
                },
            ],
        });

        expect(app.backend.getBgAt(new Point(editor.gutterWidth, 1))).toBe(REMOVED_TEXT_BG);
        expect(app.backend.getBgAt(new Point(editor.gutterWidth + 9, 1))).toBe(REMOVED_BG);
    });

    it("a gutter marker adds a column after the digits and draws a glyph", () => {
        const plain = createEditor("a\nb", {});
        const marked = createEditor("a\nb", { gutterMarkers: [{ line: 1, char: "-" }] });

        expect(marked.editor.gutterWidth).toBe(plain.editor.gutterWidth + 1);
        const markerX = 2 + 1; // GUTTER_LEFT_PADDING + digitCount
        expect(marked.app.backend.getTextAt(new Point(markerX, 1), 1)).toBe("-");
        expect(marked.app.backend.getTextAt(new Point(markerX, 0), 1)).toBe(" ");
    });

    it("zone decoration: the filler fills the zone row, the badge draws text", () => {
        const { app, editor } = createEditor(
            "alpha\nbravo",
            {
                zones: [
                    { afterLine: 0, fillChar: "░", colorToken: "diffEditor.diagonalFill" },
                    { afterLine: 1, text: "⋯ 5 unchanged lines", colorToken: "diffEditor.unchangedRegionForeground" },
                ],
            },
            [
                { afterLine: 0, size: 1 },
                { afterLine: 1, size: 1 },
            ],
        );

        const gutterW = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gutterW, 1), 3)).toBe("░░░");
        expect(app.backend.getFgAt(new Point(gutterW, 1))).toBe(FILLER_FG);
        expect(app.backend.getTextAt(new Point(gutterW, 3), 5)).toBe("⋯ 5 u");
        // A view zone without its own background uses the editor background, under the filler and the placeholder.
        expect(app.backend.getBgAt(new Point(gutterW, 1))).toBe(BG);
        expect(app.backend.getBgAt(new Point(gutterW + 1, 3))).toBe(BG);
    });

    it("translucent line and zone backgrounds blend onto the editor background as one layer", () => {
        const { app, editor } = createEditor(
            "alpha\nbravo",
            {
                lineBackgrounds: [{ startLine: 1, endLine: 1, colorToken: "diffEditor.insertedLineBackground" }],
                zones: [{ afterLine: 0, lines: [{ text: "ghost", bgToken: "diffEditor.insertedLineBackground" }] }],
            },
            [{ afterLine: 0, size: 1 }],
        );

        const gutterW = editor.gutterWidth;
        const once = compositeOver(TRANSLUCENT_BG, BG);
        // View: alpha, ghost (view zone), bravo (decorated line).
        expect(app.backend.getBgAt(new Point(gutterW, 1))).toBe(once); // view zone text
        expect(app.backend.getBgAt(new Point(gutterW + 8, 1))).toBe(once); // view zone fill past the text
        expect(app.backend.getBgAt(new Point(gutterW, 2))).toBe(once); // line text
        expect(app.backend.getBgAt(new Point(0, 2))).toBe(once); // line gutter
        // A double layer would give a different color.
        expect(once).not.toBe(compositeOver(TRANSLUCENT_BG, once));
    });

    it("a zone without decoration stays empty", () => {
        const { app, editor } = createEditor("alpha\nbravo", {}, [{ afterLine: 0, size: 1 }]);

        expect(app.backend.getTextAt(new Point(editor.gutterWidth, 1), 5)).toBe("     ");
    });

    it("multi-line zone: lines[offset] with per-line background, clipping and a tail without a line", () => {
        const { app, editor } = createEditor(
            "alpha\nbravo",
            {
                zones: [
                    {
                        afterLine: 0,
                        lines: [
                            { text: "ghost-one", bgToken: "diffEditor.removedLineBackground" },
                            {
                                text: "ghost-two-very-long-tail-past-the-edge",
                                bgToken: "diffEditor.removedLineBackground",
                                colorToken: "diffEditor.unchangedRegionForeground",
                            },
                        ],
                    },
                ],
            },
            [{ afterLine: 0, size: 3 }],
        );

        // View: alpha, ghost-one, ghost-two…, (empty view zone row), bravo.
        const gutterW = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gutterW, 1), 9)).toBe("ghost-one");
        expect(app.backend.getBgAt(new Point(gutterW + 1, 1))).toBe(REMOVED_BG);
        expect(app.backend.getBgAt(new Point(0, 1))).not.toBe(REMOVED_BG);
        expect(app.backend.getTextAt(new Point(gutterW, 2), 5)).toBe("ghost");
        expect(app.backend.getBgAt(new Point(gutterW + 3, 2))).toBe(REMOVED_BG);
        expect(app.backend.getBgAt(new Point(gutterW + 1, 3))).not.toBe(REMOVED_BG);
        expect(app.backend.getTextAt(new Point(gutterW, 3), 3)).toBe("   ");
        expect(app.backend.getTextAt(new Point(gutterW, 4), 5)).toBe("bravo");
    });
});
