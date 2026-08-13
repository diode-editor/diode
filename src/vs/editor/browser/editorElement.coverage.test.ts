import { describe, expect, it, vi } from "vitest";

import { packRgb } from "@tuidom/all/common/colorUtils";
import { Point, Size } from "@tuidom/all/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/all/dom/events/tuiKeyboardEvent";
import { TUIMouseEvent } from "@tuidom/all/dom/events/tuiMouseEvent";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { createSelection } from "../common/core/iSelection.ts";
import { createLineTokens, createToken } from "../common/languages/iLineTokens.ts";
import type { IState } from "../common/languages/iState.ts";
import { NULL_STATE } from "../common/languages/iState.ts";
import type { ITokenizationResult, ITokenizationSupport } from "../common/languages/iTokenizationSupport.ts";
import type { ITokenStyleResolver, ResolvedTokenStyle } from "../common/languages/iTokenStyleResolver.ts";
import { EMPTY_RESOLVED_TOKEN_STYLE } from "../common/languages/iTokenStyleResolver.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { DocumentTokenStore } from "../common/tokens/documentTokenStore.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

// A tokenizer that reports zero tokens for every line. The renderer therefore
// gets a non-null ILineTokens whose `tokens` array is empty, so TokenIndex.tokenAt
// returns undefined even for an in-range slot.
class EmptyTokenizer implements ITokenizationSupport {
    public getInitialState(): IState {
        return NULL_STATE;
    }
    public tokenizeLine(_line: string, _state: IState): ITokenizationResult {
        return { tokens: createLineTokens([]), endState: NULL_STATE };
    }
}

// A tokenizer that puts a single token covering the whole line.
class WholeLineTokenizer implements ITokenizationSupport {
    public getInitialState(): IState {
        return NULL_STATE;
    }
    public tokenizeLine(_line: string, _state: IState): ITokenizationResult {
        return { tokens: createLineTokens([createToken(0, ["styled"])]), endState: NULL_STATE };
    }
}

const STYLED_FG = packRgb(10, 20, 30);
const STYLED_BG = packRgb(200, 100, 50);

// Resolver that returns a fully-styled token: fg, bg, and every style flag.
class FullStyleResolver implements ITokenStyleResolver {
    public resolve(scopes: readonly string[]): ResolvedTokenStyle {
        if (scopes.includes("styled")) {
            return {
                fg: STYLED_FG,
                bg: STYLED_BG,
                bold: true,
                italic: true,
                underline: true,
                strikethrough: true,
            };
        }
        return EMPTY_RESOLVED_TOKEN_STYLE;
    }
}

function fireMouseDown(editor: EditorElement, x: number, y: number, button: "left" | "right" = "left"): void {
    editor.dispatchEvent(new TUIMouseEvent("mousedown", { button, screenX: x, screenY: y, localX: x, localY: y }));
}

function fireKeyPress(
    editor: EditorElement,
    init: { key: string; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean },
): void {
    editor.dispatchEvent(new TUIKeyboardEvent("keypress", init));
}

describe("EditorElement — token rendering edge cases", () => {
    it("falls back to editor colours when a line's token list is empty", () => {
        // tokenIndex is non-null but TokenIndex.tokenAt returns undefined → the
        // `if (token)` branch is skipped and the cell keeps the editor's fg/bg.
        const doc = new TextDocument("abc");
        const viewState = new EditorViewState(doc);
        viewState.tokenStore = new DocumentTokenStore(doc, new EmptyTokenizer());
        const editor = new EditorElement(viewState);
        editor.occurrenceHighlightEnabled = false; // isolate token-bg fallback from word highlighting
        editor.tokenStyleResolver = new FullStyleResolver();
        const app = TestApp.createWithContent(editor, new Size(30, 4));
        app.render();

        const gw = editor.gutterWidth;
        expect(app.backend.getFgAt(new Point(gw, 0))).toBe(editor.resolvedStyle.fg);
        // No styled token applied, so the background stays the editor background.
        expect(app.backend.getBgAt(new Point(gw, 0))).toBe(editor.resolvedStyle.bg);
    });

    it("applies token background and all style flags from the resolver", () => {
        // Exercises `resolved.bg !== undefined` plus every flag in packStyleFlags.
        const doc = new TextDocument("abc");
        const viewState = new EditorViewState(doc);
        viewState.tokenStore = new DocumentTokenStore(doc, new WholeLineTokenizer());
        const editor = new EditorElement(viewState);
        editor.occurrenceHighlightEnabled = false; // isolate token-bg from word highlighting
        editor.tokenStyleResolver = new FullStyleResolver();
        const app = TestApp.createWithContent(editor, new Size(30, 4));
        app.render();

        const gw = editor.gutterWidth;
        // fg + bg from the resolver are observable; the four style flags are folded
        // into packStyleFlags during this render pass (exercising those branches).
        expect(app.backend.getFgAt(new Point(gw, 0))).toBe(STYLED_FG);
        expect(app.backend.getBgAt(new Point(gw, 0))).toBe(STYLED_BG);
    });

    it("skips tokenization when no visual line is in range (zero-height viewport)", () => {
        // With height 0, lastVisibleLogical resolves to -1, so tokenizeUpTo is never called.
        const doc = new TextDocument("abc\ndef");
        const viewState = new EditorViewState(doc);
        const store = new DocumentTokenStore(doc, new WholeLineTokenizer());
        const spy = vi.spyOn(store, "tokenizeUpTo");
        viewState.tokenStore = store;
        const editor = new EditorElement(viewState);
        const app = TestApp.createWithContent(editor, new Size(30, 0));
        app.render();

        expect(spy).not.toHaveBeenCalled();
    });
});

describe("EditorElement — selection highlight across non-selected lines", () => {
    it("only paints the selected line, skipping visible lines outside the range", () => {
        // Selection covers line 1 only. The highlight loop iterates every visible
        // line (0,1,2); lines 0 and 2 are outside the range and hit `continue`.
        const doc = new TextDocument("aaa\nbbb\nccc");
        const viewState = new EditorViewState(doc, [createSelection(1, 0, 1, 3)]);
        const editor = new EditorElement(viewState);
        const app = TestApp.createWithContent(editor, new Size(30, 4));
        app.render();

        const gw = editor.gutterWidth;
        const SELECTION_BG = packRgb(38, 79, 120);
        // Line 1 is highlighted.
        expect(app.backend.getBgAt(new Point(gw, 1))).toBe(SELECTION_BG);
        // Line 0 (above) and line 2 (below) are NOT highlighted.
        expect(app.backend.getBgAt(new Point(gw, 0))).not.toBe(SELECTION_BG);
        expect(app.backend.getBgAt(new Point(gw, 2))).not.toBe(SELECTION_BG);
    });

    it("highlights a 3-line selection with partial start/end and a full middle line", () => {
        // Start line 0 from char 1, full middle line 1, end line 2 up to char 2.
        // Exercises both arms of the start/end ternaries: the middle line uses the
        // `: 0` and `: length + 1` fallbacks.
        const doc = new TextDocument("aaaa\nbbbb\ncccc");
        const viewState = new EditorViewState(doc, [createSelection(0, 1, 2, 2)]);
        const editor = new EditorElement(viewState);
        const app = TestApp.createWithContent(editor, new Size(30, 5));
        app.render();

        const gw = editor.gutterWidth;
        const SELECTION_BG = packRgb(38, 79, 120);
        // Start line: char 0 is before the selection start (char 1) → not highlighted.
        expect(app.backend.getBgAt(new Point(gw, 0))).not.toBe(SELECTION_BG);
        expect(app.backend.getBgAt(new Point(gw + 1, 0))).toBe(SELECTION_BG);
        // Middle line: fully highlighted from column 0.
        expect(app.backend.getBgAt(new Point(gw, 1))).toBe(SELECTION_BG);
        // End line: char 0 and 1 highlighted (up to char 2), char 2 not.
        expect(app.backend.getBgAt(new Point(gw, 2))).toBe(SELECTION_BG);
        expect(app.backend.getBgAt(new Point(gw + 2, 2))).not.toBe(SELECTION_BG);
    });
});

describe("EditorElement — keypress modifier handling", () => {
    function makeEditor(text: string): EditorElement {
        const doc = new TextDocument(text);
        const viewState = new EditorViewState(doc);
        const editor = new EditorElement(viewState);
        TestApp.createWithContent(editor, new Size(30, 4));
        return editor;
    }

    it("types a plain printable character", () => {
        const editor = makeEditor("");
        fireKeyPress(editor, { key: "x" });
        expect(editor.viewState.document.getText()).toBe("x");
    });

    it("ignores a single character held with Ctrl", () => {
        const editor = makeEditor("ab");
        fireKeyPress(editor, { key: "c", ctrlKey: true });
        expect(editor.viewState.document.getText()).toBe("ab");
    });

    it("ignores a single character held with Alt", () => {
        const editor = makeEditor("ab");
        fireKeyPress(editor, { key: "d", altKey: true });
        expect(editor.viewState.document.getText()).toBe("ab");
    });

    it("ignores a single character held with Meta", () => {
        const editor = makeEditor("ab");
        fireKeyPress(editor, { key: "v", metaKey: true });
        expect(editor.viewState.document.getText()).toBe("ab");
    });

    it("ignores a multi-character named key", () => {
        const editor = makeEditor("ab");
        fireKeyPress(editor, { key: "ArrowLeft" });
        expect(editor.viewState.document.getText()).toBe("ab");
    });
});
