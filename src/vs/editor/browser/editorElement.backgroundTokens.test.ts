import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../TestUtils/TestApp.ts";
import { TokenMetadata } from "../common/encodedTokenAttributes.ts";
import { WordTokenColor, WordTokenizer } from "../common/languages/builtin/wordTokenizer.ts";
import type { ITokenStyleResolver, ResolvedTokenStyle } from "../common/languages/iTokenStyleResolver.ts";
import { EMPTY_RESOLVED_TOKEN_STYLE } from "../common/languages/iTokenStyleResolver.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { DocumentTokenStore } from "../common/tokens/documentTokenStore.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

const KEYWORD_FG = packRgb(255, 0, 0);

class StubResolver implements ITokenStyleResolver {
    public resolve(metadata: number): ResolvedTokenStyle {
        const foreground: number = TokenMetadata.getForeground(metadata);
        return foreground === WordTokenColor.keyword
            ? { ...EMPTY_RESOLVED_TOKEN_STYLE, fg: KEYWORD_FG }
            : EMPTY_RESOLVED_TOKEN_STYLE;
    }
}

function createEditor(lineCount: number): {
    app: TestApp;
    editor: EditorElement;
    store: DocumentTokenStore;
    tokenizer: WordTokenizer;
} {
    const doc = new TextDocument(new Array<string>(lineCount).fill("if x").join("\n"));
    const viewState = new EditorViewState(doc);
    const tokenizer = new WordTokenizer();
    const store = new DocumentTokenStore(doc, tokenizer);
    viewState.tokenStore = store;
    const editor = new EditorElement(viewState);
    editor.tokenStyleResolver = new StubResolver();
    const app = TestApp.createWithContent(editor, new Size(20, 5));
    return { app, editor, store, tokenizer };
}

describe("EditorElement — токены вне кадра", () => {
    it("вьюпорт в конце большого файла красится сразу, токенизируя только его строки", () => {
        const { app, editor, tokenizer } = createEditor(50_000);
        const spy = vi.spyOn(tokenizer, "tokenizeEncoded");
        editor.viewState.scrollTop = 50_000 - 5;

        app.render();

        // Five viewport lines, not the 50 thousand before it.
        expect(spy).toHaveBeenCalledTimes(5);
        expect(app.backend.getFgAt(new Point(editor.gutterWidth, 4))).toBe(KEYWORD_FG);
    });

    it("токены строк на экране сменились — кадр; за экраном — нет", () => {
        const { app, editor } = createEditor(100);
        editor.viewState.scrollTop = 10;
        app.render();
        expect(editor.needsRepaint).toBe(false);

        editor.handleTokensChanged(0, 9);
        editor.handleTokensChanged(15, 40);
        expect(editor.needsRepaint).toBe(false);

        editor.handleTokensChanged(14, 14);
        expect(editor.needsRepaint).toBe(true);
        app.render();

        editor.handleTokensChanged(5, 10);
        expect(editor.needsRepaint).toBe(true);
    });

    it("до первого кадра экрана нет — и просить перерисовку не о чем", () => {
        // No app: TestApp takes a frame right on creation.
        const editor = new EditorElement(new EditorViewState(new TextDocument("if x")));
        const markDirty = vi.spyOn(editor, "markDirty");
        editor.handleTokensChanged(0, 9);
        expect(markDirty).not.toHaveBeenCalled();
    });
});
