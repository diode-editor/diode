import { describe, expect, it } from "vitest";

import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { MarkerSeverity } from "../../platform/markers/common/iMarker.ts";
import { createRange } from "../common/core/iRange.ts";
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
        // Covered cells (a, b, c) take the warning colour.
        expect(app.backend.getFgAt(new Point(gw + 0, 0))).toBe(WARNING_FG);
        expect(app.backend.getFgAt(new Point(gw + 2, 0))).toBe(WARNING_FG);
        // The cell just past the range keeps the editor foreground.
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

// Файл с ошибкой на каждой строке (стоковый eslint делает это за пару секунд)
// красил вертикальные направляющие фолдинга в красный: squiggle ставил свой fg
// на ВСЕ ячейки диапазона, включая отступ, где уже лежит глиф `│`. В VS Code
// направляющая — отдельный слой, и подчёркивание её цвет не трогает.
describe("EditorElement — squiggle over indentation guides", () => {
    // Вложенные области: на строке 2 (`        return 1;`) ДВА гайда — от внешней
    // функции (колонка 0) и от `if` (колонка 4).
    const SAMPLE = ["function foo() {", "    if (ready) {", "        return 1;", "    }", "}"].join("\n");
    const ERROR_FG = packRgb(0xf1, 0x4c, 0x4c); // default editorError.foreground
    // Каретка стоит на строке 0: её охватывает только внешняя область, поэтому
    // гайд колонки 0 активный, а вложенный (колонка 4) — обычный.
    const ACTIVE_GUIDE_FG = packRgb(0x70, 0x70, 0x70); // editorIndentGuide.activeBackground1
    const GUIDE_FG = packRgb(0x40, 0x40, 0x40); // editorIndentGuide.background1

    /** Редактор с отступным фолдингом и ошибкой на весь блок (строки 0..3). */
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
        // Строка 2 лежит внутри диапазона целиком; оба гайда держат свой цвет —
        // и внешний активный, и вложенный обычный.
        expect(app.backend.getTextAt(new Point(gw, 2), 1)).toBe("│");
        expect(app.backend.getFgAt(new Point(gw, 2))).toBe(ACTIVE_GUIDE_FG);
        expect(app.backend.getTextAt(new Point(gw + 4, 2), 1)).toBe("│");
        expect(app.backend.getFgAt(new Point(gw + 4, 2))).toBe(GUIDE_FG);
    });

    it("still marks the guide cells with an undercurl", () => {
        const { app, editor } = makeFoldedEditor();
        const gw = editor.gutterWidth;
        // Волна проходит через отступ — диагностика на строке видна и там.
        expect(app.app.screen.getCell(new Point(gw, 2)).style & StyleFlags.Undercurl).toBe(StyleFlags.Undercurl);
        expect(app.app.screen.getCell(new Point(gw + 4, 2)).style & StyleFlags.Undercurl).toBe(StyleFlags.Undercurl);
    });

    it("still paints the severity colour on the range's text cells", () => {
        const { app, editor } = makeFoldedEditor();
        const gw = editor.gutterWidth;
        // "return" на строке 2 начинается с колонки 8 — обычная ячейка текста.
        expect(app.backend.getTextAt(new Point(gw + 8, 2), 1)).toBe("r");
        expect(app.backend.getFgAt(new Point(gw + 8, 2))).toBe(ERROR_FG);
        expect(app.app.screen.getCell(new Point(gw + 8, 2)).style & StyleFlags.Undercurl).toBe(StyleFlags.Undercurl);
    });

    it("paints the severity colour on whitespace that carries no guide", () => {
        const { app, editor } = makeFoldedEditor();
        const gw = editor.gutterWidth;
        // Колонка 1 строки 2 — тот же отступ, но направляющей там нет: цвет ошибки.
        expect(app.backend.getTextAt(new Point(gw + 1, 2), 1)).toBe(" ");
        expect(app.backend.getFgAt(new Point(gw + 1, 2))).toBe(ERROR_FG);
    });
});
