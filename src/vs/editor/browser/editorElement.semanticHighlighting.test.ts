import { packRgb } from "@tuidom/core/common/colorUtils";
import { BoxConstraints, Offset, Point, Rect, Size } from "@tuidom/core/common/geometryPromitives";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import { extendVarScope, ROOT_STYLE_CONTEXT } from "@tuidom/core/dom/styles/tuiStyle";
import { RenderContext } from "@tuidom/core/dom/tuiElement";
import { TerminalScreen } from "@tuidom/core/rendering/terminalScreen";
import { describe, expect, it } from "vitest";

import { Event } from "../../base/common/event.ts";
import { WordTokenizer } from "../common/languages/builtin/wordTokenizer.ts";
import type { ISemanticTokensLegend } from "../common/languages/iSemanticTokensSource.ts";
import type {
    ISemanticTokenStyleResolver,
    SemanticTokenStyle,
} from "../common/languages/iSemanticTokenStyleResolver.ts";
import type { ITokenStyleResolver, ResolvedTokenStyle } from "../common/languages/iTokenStyleResolver.ts";
import { EMPTY_RESOLVED_TOKEN_STYLE } from "../common/languages/iTokenStyleResolver.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { DocumentTokenStore } from "../common/tokens/documentTokenStore.ts";
import { decodeSemanticTokens } from "../common/tokens/semanticTokensLines.ts";
import { SemanticTokensStore } from "../common/tokens/semanticTokensStore.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

const KEYWORD_FG = packRgb(255, 0, 0);
const CLASS_FG = packRgb(0, 200, 100);
const VAR_FG = packRgb(10, 20, 30);

/** TextMate: `if` — красный курсивом, остальное — без правила. */
class TmResolver implements ITokenStyleResolver {
    public resolve(scopes: readonly string[]): ResolvedTokenStyle {
        return scopes.includes("keyword.control")
            ? { ...EMPTY_RESOLVED_TOKEN_STYLE, fg: KEYWORD_FG, italic: true }
            : EMPTY_RESOLVED_TOKEN_STYLE;
    }
}

const LEGEND: ISemanticTokensLegend = {
    tokenTypes: ["class", "variable", "keyword", "unstyled"],
    tokenModifiers: ["readonly", "static"],
};

/** Тема: class — свой цвет, variable.readonly — жирный без цвета, keyword — снять курсив. */
function themeResolver(): ISemanticTokenStyleResolver & { calls: string[] } {
    const calls: string[] = [];
    return {
        calls,
        semanticHighlighting: true,
        onDidChange: Event.None,
        resolve(type, modifiers, languageId): SemanticTokenStyle | null {
            calls.push(`${type}[${modifiers.join(",")}]:${languageId}`);
            if (type === "class") return { fg: CLASS_FG };
            if (type === "variable" && modifiers.includes("readonly")) return { bold: true };
            if (type === "variable") return { fg: VAR_FG };
            if (type === "keyword") return { italic: false, underline: true };
            return null;
        },
    };
}

function setup(text: string, data: number[], width = 30, height = 2) {
    const doc = new TextDocument(text, "java");
    const viewState = new EditorViewState(doc);
    viewState.tokenStore = new DocumentTokenStore(doc, new WordTokenizer());
    const semantic = new SemanticTokensStore(doc);
    semantic.set(decodeSemanticTokens(new Uint32Array(data), LEGEND), true);
    viewState.semanticTokens = semantic;
    const editor = new EditorElement(viewState);
    editor.tokenStyleResolver = new TmResolver();
    const resolver = themeResolver();
    editor.semanticTokenStyleResolver = resolver;
    const size = new Size(width, height);
    const screen = new TerminalScreen(size);
    const render = (): void => {
        editor.localPosition = new Offset(0, 0);
        editor.layout(BoxConstraints.tight(size));
        editor.performStyleResolution({
            ...ROOT_STYLE_CONTEXT,
            vars: extendVarScope(ROOT_STYLE_CONTEXT.vars, {
                "editor.selectionBackground": packRgb(38, 79, 120),
                "editorGhostText.foreground": packRgb(90, 90, 90),
            }),
        });
        editor.render(new RenderContext(screen, new Offset(0, 0), new Rect(new Point(0, 0), size)));
    };
    render();
    const cell = (col: number, row = 0) => screen.getCell(new Point(editor.gutterWidth + col, row));
    return { doc, editor, semantic, resolver, render, cell };
}

describe("EditorElement — семантические токены поверх TextMate", () => {
    it("цвет семантического токена перекрывает TM только в границах токена", () => {
        // "Foo bar": Foo — class (0..3).
        const { cell, editor } = setup("Foo bar", [0, 0, 3, 0, 0]);
        expect(cell(0).fg).toBe(CLASS_FG);
        expect(cell(2).fg).toBe(CLASS_FG);
        expect(cell(4).fg).toBe(editor.resolvedStyle.fg);
    });

    it("стиль без цвета оставляет цвет TM и меняет только заданные флаги", () => {
        // "if": TM — красный курсив; семантика keyword — italic:false, underline:true.
        const { cell } = setup("if x", [0, 0, 2, 2, 0]);
        expect(cell(0).fg).toBe(KEYWORD_FG);
        expect(cell(0).style & StyleFlags.Italic).toBe(0);
        expect(cell(0).style & StyleFlags.Underline).toBe(StyleFlags.Underline);
        // x — без семантики: TM ничего не задал.
        expect(cell(3).style).toBe(StyleFlags.None);
    });

    it("модификаторы — по битам легенды: variable.readonly жирный, просто variable — свой цвет", () => {
        const { cell, resolver } = setup("ab cd", [0, 0, 2, 1, 0b01, 0, 3, 2, 1, 0]);
        expect(cell(0).style & StyleFlags.Bold).toBe(StyleFlags.Bold);
        expect(cell(3).fg).toBe(VAR_FG);
        expect(cell(3).style & StyleFlags.Bold).toBe(0);
        expect(resolver.calls).toEqual(["variable[readonly]:java", "variable[]:java"]);
    });

    it("биты за пределами легенды игнорируются, тип вне легенды не стилизуется", () => {
        const { cell, resolver, editor } = setup("ab cd", [0, 0, 2, 1, 0b100, 0, 3, 2, 9, 0]);
        expect(cell(0).fg).toBe(VAR_FG);
        expect(cell(3).fg).toBe(editor.resolvedStyle.fg);
        expect(resolver.calls).toEqual(["variable[]:java"]);
    });

    it("токен без стиля в теме TM не трогает", () => {
        const { cell } = setup("if", [0, 0, 2, 3, 0]);
        expect(cell(0).fg).toBe(KEYWORD_FG);
        expect(cell(0).style & StyleFlags.Italic).toBe(StyleFlags.Italic);
    });

    it("стиль считается раз на (легенда, тип, модификаторы) за кадр", () => {
        const { resolver } = setup("ab ab ab", [0, 0, 2, 1, 0, 0, 3, 2, 1, 0, 0, 3, 2, 1, 0]);
        expect(resolver.calls).toEqual(["variable[]:java"]);
    });

    it("вторая строка документа берёт свои токены", () => {
        const { cell } = setup("x\nFoo", [1, 0, 3, 0, 0]);
        expect(cell(0, 0).fg).not.toBe(CLASS_FG);
        expect(cell(0, 1).fg).toBe(CLASS_FG);
    });

    it("правка документа сдвигает токены до свежего ответа", () => {
        const { doc, cell, render } = setup("Foo bar", [0, 0, 3, 0, 0]);
        doc.applyEdits([{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: "  " }]);
        render();
        expect(cell(0).fg).not.toBe(CLASS_FG);
        expect(cell(2).fg).toBe(CLASS_FG);
        expect(cell(4).fg).toBe(CLASS_FG);
    });

    it("правее ghost text семантика не уезжает", () => {
        const { editor, cell, render } = setup("a Foo", [0, 2, 3, 0, 0]);
        editor.setGhostText({ line: 0, character: 1, lines: ["XYZ"] });
        render();
        // "a" + "XYZ" + " Foo": Foo начинается с колонки 5.
        expect(cell(4).fg).not.toBe(CLASS_FG);
        expect(cell(5).fg).toBe(CLASS_FG);
        expect(cell(7).fg).toBe(CLASS_FG);
    });

    it("без хранилища семантики рисуется только TM", () => {
        const { editor, cell, render } = setup("Foo", [0, 0, 3, 0, 0]);
        editor.viewState.semanticTokens = undefined;
        render();
        expect(cell(0).fg).not.toBe(CLASS_FG);
    });

    it("резолвер не зовётся, когда семантических токенов нет", () => {
        const { resolver } = setup("Foo", []);
        expect(resolver.calls).toEqual([]);
    });
});
