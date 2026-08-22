import { describe, expect, it } from "vitest";

import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { createFoldingRegion } from "../contrib/folding/iFoldingRegion.ts";
import { createCursorSelection } from "../common/core/iSelection.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

const CARET_BG = packRgb(0xae, 0xaf, 0xad);

function createEditor(
    text: string,
    width = 30,
    height = 5,
): { app: TestApp; editor: EditorElement; viewState: EditorViewState; gw: number } {
    const doc = new TextDocument(text);
    const viewState = new EditorViewState(doc);
    const editor = new EditorElement(viewState);
    const app = TestApp.createWithContent(editor, new Size(width, height));
    return { app, editor, viewState, gw: editor.gutterWidth };
}

function makeLines(count: number): string {
    return Array.from({ length: count }, (_, i) => `line ${i.toString()}`).join("\n");
}

describe("EditorElement — геометрия вторичных кареток", () => {
    it("широкий символ: глиф и ширина целы, продолжение прокрашено", () => {
        const { app, editor, viewState, gw } = createEditor("漢x漢");
        viewState.selections = [createCursorSelection(0, 0), createCursorSelection(0, 1)];
        editor.focus();
        app.render();

        const head = app.app.screen.getCell(new Point(gw + 0, 0));
        expect(head.char).toBe("漢");
        expect(head.width).toBe(2);
        expect(app.backend.getBgAt(new Point(gw + 0, 0))).toBe(CARET_BG);
        // Ячейка-продолжение широкого символа окрашивается движком заодно с головой.
        expect(app.backend.getBgAt(new Point(gw + 1, 0))).toBe(CARET_BG);
    });

    it("каретка после широкого символа встаёт в его дисплейную колонку", () => {
        const { app, editor, viewState, gw } = createEditor("漢x");
        viewState.selections = [createCursorSelection(0, 1), createCursorSelection(0, 2)];
        editor.focus();
        app.render();

        // Смещение 1 — это дисплейная колонка 2 (широкий символ занял 0 и 1).
        expect(app.backend.getBgAt(new Point(gw + 2, 0))).toBe(CARET_BG);
    });

    it("таб: инвертирована ровно одна колонка из четырёх", () => {
        const { app, editor, viewState, gw } = createEditor("\tx\n\ty");
        editor.tabSize = 4;
        viewState.selections = [createCursorSelection(0, 0), createCursorSelection(1, 0)];
        editor.focus();
        app.render();

        expect(app.backend.getBgAt(new Point(gw + 0, 0))).toBe(CARET_BG);
        expect(app.backend.getBgAt(new Point(gw + 1, 0))).toBe(editor.resolvedStyle.bg);
        expect(app.backend.getBgAt(new Point(gw + 3, 0))).toBe(editor.resolvedStyle.bg);
    });

    it("каретка за концом строки рисуется на пустой ячейке", () => {
        const { app, editor, viewState, gw } = createEditor("abc\nabcdef");
        viewState.selections = [createCursorSelection(0, 3), createCursorSelection(1, 6)];
        editor.focus();
        app.render();

        expect(app.backend.getBgAt(new Point(gw + 3, 0))).toBe(CARET_BG);
        expect(app.backend.getTextAt(new Point(gw + 3, 0), 1)).toBe(" ");
    });

    it("каретка на пустой строке рисуется в колонке 0", () => {
        const { app, editor, viewState, gw } = createEditor("abc\n\ndef");
        viewState.selections = [createCursorSelection(0, 0), createCursorSelection(1, 0)];
        editor.focus();
        app.render();

        expect(app.backend.getBgAt(new Point(gw + 0, 1))).toBe(CARET_BG);
    });

    it("две каретки на одной строке рисуются обе", () => {
        const { app, editor, viewState, gw } = createEditor("abcdef");
        viewState.selections = [createCursorSelection(0, 1), createCursorSelection(0, 4)];
        editor.focus();
        app.render();

        expect(app.backend.getBgAt(new Point(gw + 1, 0))).toBe(CARET_BG);
        expect(app.backend.getBgAt(new Point(gw + 4, 0))).toBe(CARET_BG);
    });

    it("каретка внутри свёрнутого региона не рисуется, а заголовок не пачкается", () => {
        const { app, editor, viewState, gw } = createEditor("header\n  body\nafter");
        viewState.selections = [createCursorSelection(2, 0), createCursorSelection(1, 2)];
        viewState.foldedRegions = [createFoldingRegion(0, 1, true)];
        editor.focus();
        app.render();

        // Строка вью 0 — заголовок; каретки на скрытой строке 1 в кадре нет.
        for (let x = 0; x < 6; x++) {
            expect(app.backend.getBgAt(new Point(gw + x, 0))).not.toBe(CARET_BG);
        }
    });

    it("каретка выше и ниже вьюпорта не рисуется", () => {
        const { app, editor, viewState, gw } = createEditor(makeLines(40), 30, 4);
        viewState.scrollTop = 10;
        viewState.selections = [createCursorSelection(0, 0), createCursorSelection(11, 0), createCursorSelection(39, 0)];
        editor.focus();
        app.render();

        // Видна только каретка строки 11 → экранная строка 1.
        expect(app.backend.getBgAt(new Point(gw + 0, 1))).toBe(CARET_BG);
        expect(app.backend.getBgAt(new Point(gw + 0, 0))).not.toBe(CARET_BG);
        expect(app.backend.getBgAt(new Point(gw + 0, 3))).not.toBe(CARET_BG);
    });

    it("горизонтальный скролл: каретка левее вьюпорта пропадает, на его краю — рисуется", () => {
        const { app, editor, viewState, gw } = createEditor("abcdefghijklmnop\nabcdefghijklmnop", 20, 4);
        viewState.scrollLeft = 5;
        viewState.selections = [createCursorSelection(0, 2), createCursorSelection(1, 5)];
        editor.focus();
        app.render();

        // Каретка строки 1 ровно на левом крае вьюпорта.
        expect(app.backend.getBgAt(new Point(gw + 0, 1))).toBe(CARET_BG);
        // Каретка строки 0 уехала влево — в кадре её нет ни в одной колонке.
        for (let x = 0; x + gw < 20; x++) {
            expect(app.backend.getBgAt(new Point(gw + x, 0))).not.toBe(CARET_BG);
        }
    });

    it("горизонтальный скролл: каретка правее вьюпорта не рисуется", () => {
        const { app, editor, viewState, gw } = createEditor("abcdefghijklmnopqrstuvwxyz\nabc", 14, 4);
        viewState.selections = [createCursorSelection(0, 25), createCursorSelection(1, 0)];
        editor.focus();
        app.render();

        expect(app.backend.getBgAt(new Point(gw + 0, 1))).toBe(CARET_BG);
        for (let x = 0; x + gw < 14; x++) {
            expect(app.backend.getBgAt(new Point(gw + x, 0))).not.toBe(CARET_BG);
        }
    });

    it("строка-зона остаётся чистой, а каретка под ней съезжает вместе с проекцией", () => {
        const { app, editor, viewState, gw } = createEditor("aaa\nbbb\nccc", 20, 5);
        viewState.setViewZones([{ afterLine: 0, size: 1 }]);
        viewState.selections = [createCursorSelection(0, 0), createCursorSelection(1, 0)];
        editor.focus();
        app.render();

        expect(app.backend.getBgAt(new Point(gw + 0, 0))).toBe(CARET_BG);
        // Экранная строка 1 — зона: документной строки за ней нет.
        expect(app.backend.getBgAt(new Point(gw + 0, 1))).not.toBe(CARET_BG);
        // Строка 1 документа уехала на экранную 2.
        expect(app.backend.getBgAt(new Point(gw + 0, 2))).toBe(CARET_BG);
    });
});
