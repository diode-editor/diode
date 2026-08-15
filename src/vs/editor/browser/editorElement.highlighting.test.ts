import { describe, expect, it, vi } from "vitest";

import { packRgb } from "@tuidom/core/common/colorUtils";
import { BoxConstraints, Offset, Point, Rect, Size } from "@tuidom/core/common/geometryPromitives";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { ROOT_STYLE_CONTEXT } from "@tuidom/core/dom/styles/tuiStyle";
import { RenderContext } from "@tuidom/core/dom/tuiElement";
import { TerminalScreen } from "@tuidom/core/rendering/terminalScreen";
import { WordTokenizer } from "../common/languages/builtin/wordTokenizer.ts";
import type { ITokenStyleResolver, ResolvedTokenStyle } from "../common/languages/iTokenStyleResolver.ts";
import { EMPTY_RESOLVED_TOKEN_STYLE } from "../common/languages/iTokenStyleResolver.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { DocumentTokenStore } from "../common/tokens/documentTokenStore.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

const KEYWORD_FG = packRgb(255, 0, 0);
const NUMBER_FG = packRgb(0, 255, 0);

class StubResolver implements ITokenStyleResolver {
    public resolve(scopes: readonly string[]): ResolvedTokenStyle {
        for (let i = scopes.length - 1; i >= 0; i--) {
            if (scopes[i] === "keyword.control") return { ...EMPTY_RESOLVED_TOKEN_STYLE, fg: KEYWORD_FG };
            if (scopes[i] === "constant.numeric") return { ...EMPTY_RESOLVED_TOKEN_STYLE, fg: NUMBER_FG };
        }
        return EMPTY_RESOLVED_TOKEN_STYLE;
    }
}

function createHighlightedEditor(
    text: string,
    width = 40,
    height = 4,
): {
    app: TestApp;
    editor: EditorElement;
    doc: TextDocument;
    gw: number;
} {
    const doc = new TextDocument(text);
    const viewState = new EditorViewState(doc);
    const store = new DocumentTokenStore(doc, new WordTokenizer());
    viewState.tokenStore = store;
    const editor = new EditorElement(viewState);
    editor.tokenStyleResolver = new StubResolver();
    const app = TestApp.createWithContent(editor, new Size(width, height));
    return { app, editor, doc, gw: editor.gutterWidth };
}

describe("EditorElement syntax highlighting", () => {
    it("colours a keyword cell with the resolver's foreground", () => {
        const { app, gw } = createHighlightedEditor("if x");
        app.render();
        // "if" starts at column 0 of the content area
        expect(app.backend.getFgAt(new Point(gw, 0))).toBe(KEYWORD_FG);
        expect(app.backend.getFgAt(new Point(gw + 1, 0))).toBe(KEYWORD_FG);
    });

    it("colours a numeric literal cell with the resolver's foreground", () => {
        const { app, gw } = createHighlightedEditor("123");
        app.render();
        expect(app.backend.getFgAt(new Point(gw, 0))).toBe(NUMBER_FG);
        expect(app.backend.getFgAt(new Point(gw + 1, 0))).toBe(NUMBER_FG);
        expect(app.backend.getFgAt(new Point(gw + 2, 0))).toBe(NUMBER_FG);
    });

    it("falls back to the editor foreground for tokens with no rule", () => {
        const { app, editor, gw } = createHighlightedEditor("foo");
        app.render();
        expect(app.backend.getFgAt(new Point(gw, 0))).toBe(editor.resolvedStyle.fg);
    });

    it("re-tokenizes on edit and updates colours", () => {
        const { app, doc, gw } = createHighlightedEditor("foo");
        app.render();
        doc.applyEdits([{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, text: "if" }]);
        app.render();
        expect(app.backend.getFgAt(new Point(gw, 0))).toBe(KEYWORD_FG);
    });
});

describe("EditorElement tokenization — вырожденный вьюпорт", () => {
    it("нулевая высота: рендер не дёргает tokenizeUpTo (нет видимых строк)", () => {
        const doc = new TextDocument("if x");
        const viewState = new EditorViewState(doc);
        const store = new DocumentTokenStore(doc, new WordTokenizer());
        viewState.tokenStore = store;
        const editor = new EditorElement(viewState);
        editor.tokenStyleResolver = new StubResolver();

        const size = new Size(20, 0);
        const backendScreen = new TerminalScreen(new Size(20, 1));
        editor.localPosition = new Offset(0, 0);
        editor.layout(BoxConstraints.tight(size));
        editor.performStyleResolution(ROOT_STYLE_CONTEXT);
        const spy = vi.spyOn(store, "tokenizeUpTo");
        editor.render(
            new RenderContext(backendScreen, new Offset(0, 0), new Rect(new Point(0, 0), new Size(20, 1))),
        );

        expect(spy).not.toHaveBeenCalled();
    });
});
