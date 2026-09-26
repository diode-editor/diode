import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../TestUtils/TestApp.ts";
import { MarkerSeverity } from "../../platform/markers/common/iMarker.ts";
import { createRange } from "../common/core/iRange.ts";
import { createCursorSelection } from "../common/core/iSelection.ts";
import { WordTokenizer } from "../common/languages/builtin/wordTokenizer.ts";
import type { ITokenStyleResolver, ResolvedTokenStyle } from "../common/languages/iTokenStyleResolver.ts";
import { EMPTY_RESOLVED_TOKEN_STYLE } from "../common/languages/iTokenStyleResolver.ts";
import type { IGhostText } from "../common/model/iGhostText.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { DocumentTokenStore } from "../common/tokens/documentTokenStore.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

/**
 * Призрачная подсказка при каретке В СЕРЕДИНЕ строки (заявка n-4): фантомные
 * колонки вставляются в отрисовку строки, а хвост строки уезжает вправо — как
 * у upstream (injected-text декорации внутри layout строки). Вместе с текстом
 * по композитной строке считают колонки и overlay-проходы этой строки: подсветка
 * токенов хвоста, волны диагностик, каретки и hit-test.
 */

const GHOST_FG = packRgb(0x6a, 0x6a, 0x6a);
const EDITOR_FG = packRgb(0xd4, 0xd4, 0xd4);
const BG = packRgb(0x1e, 0x1e, 0x1e);
const CARET_BG = packRgb(0xae, 0xaf, 0xad);
const WARNING_FG = packRgb(0xcc, 0xa7, 0x00);
const KEYWORD_FG = packRgb(0xff, 0x00, 0x00);
const NUMBER_FG = packRgb(0x00, 0xff, 0x00);

/** Раскрашивает только ключевые слова и числа — как в highlighting-тестах. */
class StubResolver implements ITokenStyleResolver {
    public resolve(scopes: readonly string[]): ResolvedTokenStyle {
        if (scopes.includes("keyword.control")) return { ...EMPTY_RESOLVED_TOKEN_STYLE, fg: KEYWORD_FG };
        if (scopes.includes("constant.numeric")) return { ...EMPTY_RESOLVED_TOKEN_STYLE, fg: NUMBER_FG };
        return EMPTY_RESOLVED_TOKEN_STYLE;
    }
}

const STYLE_VARS = {
    "editor.background": BG,
    "editor.foreground": EDITOR_FG,
    "editorGhostText.foreground": GHOST_FG,
};

function createEditor(
    text: string,
    ghost: IGhostText | null,
    size = new Size(30, 4),
): { app: TestApp; editor: EditorElement } {
    const viewState = new EditorViewState(new TextDocument(text));
    const editor = new EditorElement(viewState);
    editor.setStyleVars(STYLE_VARS);
    editor.style = { fg: "editor.foreground", bg: "editor.background" };
    editor.setGhostText(ghost);
    const app = TestApp.createWithContent(editor, size);
    app.render();
    return { app, editor };
}

describe("EditorElement — ghost text в середине строки", () => {
    it("фантом вставляется между кареткой и хвостом строки, хвост сдвигается вправо", () => {
        const { app, editor } = createEditor("call();", { line: 0, character: 5, lines: ["arg"] });

        const gutterW = editor.gutterWidth;
        // Пользователь видит целую строку: набранное + серый фантом + свой хвост.
        expect(app.backend.getTextAt(new Point(gutterW, 0), 10)).toBe("call(arg);");
        // Фантомные колонки — призрачным цветом, хвост — цветом редактора.
        expect(app.backend.getFgAt(new Point(gutterW + 5, 0))).toBe(GHOST_FG);
        expect(app.backend.getFgAt(new Point(gutterW + 7, 0))).toBe(GHOST_FG);
        expect(app.backend.getFgAt(new Point(gutterW + 8, 0))).toBe(EDITOR_FG);
        // Документ фантом не трогает.
        expect(editor.viewState.document.getText()).toBe("call();");
    });

    it("снятие подсказки возвращает строку в исходный вид", () => {
        const { app, editor } = createEditor("call();", { line: 0, character: 5, lines: ["arg"] });

        editor.setGhostText(null);
        app.render();

        const gutterW = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gutterW, 0), 10)).toBe("call();   ");
    });

    it("многострочная подсказка: хвост остаётся на строке каретки, продолжение — в зонах", () => {
        // Люфт против upstream (он уводит хвост под последнюю строку фантома):
        // зона несёт только фантомный текст, документной строке в неё не уехать.
        const { app, editor } = createEditor("call();", {
            line: 0,
            character: 5,
            lines: ["arg,", "more"],
        });

        const gutterW = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gutterW, 0), 12)).toBe("call(arg,); ");
        expect(app.backend.getTextAt(new Point(gutterW, 1), 4)).toBe("more");
        expect(app.backend.getFgAt(new Point(gutterW, 1))).toBe(GHOST_FG);
    });

    it("каретка остаётся ПЕРЕД фантомом, вторичная за ним — уезжает с хвостом", () => {
        const { app, editor } = createEditor("call();", { line: 0, character: 5, lines: ["arg"] });
        editor.setStyleVars({ ...STYLE_VARS, "editorCursor.foreground": CARET_BG });
        // Первичная каретка — в точке вставки, вторичная — в конце строки.
        editor.viewState.selections = [createCursorSelection(0, 5), createCursorSelection(0, 7)];
        editor.focus();
        app.render();

        const gutterW = editor.gutterWidth;
        // Аппаратный курсор (первичная каретка) — на колонке 5, слева от фантома.
        expect(editor.getCaretScreenCell()).toEqual(new Point(gutterW + 5, 0));
        // Вторичная каретка стояла на конце строки — она уехала вместе с хвостом
        // (offset 7 → колонка 7 + 3 фантомных).
        expect(app.backend.getBgAt(new Point(gutterW + 10, 0))).toBe(CARET_BG);
    });

    it("волна диагностики на хвосте уезжает вместе с хвостом", () => {
        const { app, editor } = createEditor("call();", { line: 0, character: 5, lines: ["arg"] });
        editor.occurrenceHighlightEnabled = false;
        editor.setStyleVars({ ...STYLE_VARS, "editorWarning.foreground": WARNING_FG });
        // Диагностика на хвосте «);» — документные колонки 5..7.
        editor.markerDecorations = [{ range: createRange(0, 5, 0, 7), severity: MarkerSeverity.Warning }];
        app.render();

        const gutterW = editor.gutterWidth;
        expect(app.backend.getFgAt(new Point(gutterW + 8, 0))).toBe(WARNING_FG);
        expect(app.backend.getFgAt(new Point(gutterW + 9, 0))).toBe(WARNING_FG);
        // Набранное левее подсказки волна не задела.
        expect(app.backend.getFgAt(new Point(gutterW + 4, 0))).toBe(EDITOR_FG);
    });

    it("клик по хвосту даёт его документную позицию, клик по фантому — точку вставки", () => {
        const { editor } = createEditor("call();", { line: 0, character: 5, lines: ["arg"] });

        const gutterW = editor.gutterWidth;
        // «)» нарисован на колонке 8, но в документе это offset 5.
        expect(editor.docPositionAt(gutterW + 8, 0)).toEqual({ line: 0, character: 5 });
        expect(editor.docPositionAt(gutterW + 9, 0)).toEqual({ line: 0, character: 6 });
        // Колонки самого фантома в документ не отображаются — отдают точку вставки.
        expect(editor.docPositionAt(gutterW + 6, 0)).toEqual({ line: 0, character: 5 });
        // Левее фантома всё как было.
        expect(editor.docPositionAt(gutterW + 2, 0)).toEqual({ line: 0, character: 2 });
    });
});

describe("EditorElement — подсветка токенов вокруг фантома", () => {
    function createTokenizedEditor(text: string, ghost: IGhostText): { app: TestApp; editor: EditorElement } {
        const doc = new TextDocument(text);
        const viewState = new EditorViewState(doc);
        viewState.tokenStore = new DocumentTokenStore(doc, new WordTokenizer());
        const editor = new EditorElement(viewState);
        editor.setStyleVars(STYLE_VARS);
        editor.style = { fg: "editor.foreground", bg: "editor.background" };
        editor.tokenStyleResolver = new StubResolver();
        editor.setGhostText(ghost);
        const app = TestApp.createWithContent(editor, new Size(30, 3));
        app.render();
        return { app, editor };
    }

    it("токены хвоста красятся своими цветами, фантом — призрачным", () => {
        // Фантом «zz » перед числом: композитная строка — «if zz 1».
        const { app, editor } = createTokenizedEditor("if 1", { line: 0, character: 3, lines: ["zz "] });

        const gutterW = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gutterW, 0), 7)).toBe("if zz 1");
        // Ключевое слово левее фантома — своим цветом.
        expect(app.backend.getFgAt(new Point(gutterW, 0))).toBe(KEYWORD_FG);
        // Фантом токена не имеет.
        expect(app.backend.getFgAt(new Point(gutterW + 3, 0))).toBe(GHOST_FG);
        // Число уехало на колонку 6 и УТАЩИЛО свой токен с собой.
        expect(app.backend.getFgAt(new Point(gutterW + 6, 0))).toBe(NUMBER_FG);
    });

    it("токены ЛЕВЕЕ фантома ищутся по своим offset'ам, а не по сдвинутым", () => {
        // Подсказка в конце строки: весь настоящий текст левее фантома. Если
        // сдвиг применить и к нему, число на колонке 3 возьмёт токен «if».
        const { app, editor } = createTokenizedEditor("if 1", { line: 0, character: 4, lines: ["zz"] });

        const gutterW = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gutterW, 0), 6)).toBe("if 1zz");
        expect(app.backend.getFgAt(new Point(gutterW, 0))).toBe(KEYWORD_FG);
        expect(app.backend.getFgAt(new Point(gutterW + 3, 0))).toBe(NUMBER_FG);
        expect(app.backend.getFgAt(new Point(gutterW + 4, 0))).toBe(GHOST_FG);
    });
});
