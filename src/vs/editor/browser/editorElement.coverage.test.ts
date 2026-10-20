import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { describe, expect, it, vi } from "vitest";

import { encodedResult, tokenMetadata } from "../../../TestUtils/encodedTokens.ts";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { createSelection } from "../common/core/iSelection.ts";
import { FontStyle } from "../common/encodedTokenAttributes.ts";
import type { EncodedTokenizationResult, ITokenizationSupport } from "../common/languages.ts";
import { ColorMapTokenStyleResolver } from "../common/languages/colorMapTokenStyleResolver.ts";
import type { IState } from "../common/languages/iState.ts";
import { NULL_STATE } from "../common/languages/iState.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { DocumentTokenStore } from "../common/tokens/documentTokenStore.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

// A tokenizer that puts a single token covering the whole line.
class WholeLineTokenizer implements ITokenizationSupport {
    public constructor(private readonly metadata: number) {}
    public getInitialState(): IState {
        return NULL_STATE;
    }
    public tokenizeEncoded(_line: string, _hasEOL: boolean, _state: IState): EncodedTokenizationResult {
        return encodedResult([[0, this.metadata]], NULL_STATE);
    }
}

const STYLED_FG = packRgb(10, 20, 30);
const STYLED_BG = packRgb(200, 100, 50);

// colorMap темы: индексы 1 и 2 (цвета по умолчанию) нарочно не совпадают с
// цветами редактора — ячейка всё равно должна взять цвета редактора.
const COLOR_MAP = ["", "#ff0000", "#00ff00", "#0a141e", "#c86432"];
const STYLED_FG_ID = 3;
const STYLED_BG_ID = 4;

const ALL_FONT_STYLES = FontStyle.Bold | FontStyle.Italic | FontStyle.Underline | FontStyle.Strikethrough;
const ALL_STYLE_FLAGS = StyleFlags.Bold | StyleFlags.Italic | StyleFlags.Underline | StyleFlags.Strikethrough;

function createStyledEditor(metadata: number): { app: TestApp; editor: EditorElement } {
    const doc = new TextDocument("abc");
    const viewState = new EditorViewState(doc);
    viewState.tokenStore = new DocumentTokenStore(doc, new WholeLineTokenizer(metadata));
    const editor = new EditorElement(viewState);
    editor.occurrenceHighlightEnabled = false; // isolate token-bg from word highlighting
    editor.tokenStyleResolver = new ColorMapTokenStyleResolver({ getColorMap: () => COLOR_MAP });
    const app = TestApp.createWithContent(editor, new Size(30, 4));
    app.render();
    return { app, editor };
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
    it("falls back to editor colours for default colour ids, whatever colorMap[1]/[2] hold", () => {
        // ColorId.DefaultForeground/DefaultBackground mean "editor colours", not
        // colorMap entries: the resolver yields undefined and the cell keeps fg/bg.
        const { app, editor } = createStyledEditor(tokenMetadata());

        const gw = editor.gutterWidth;
        expect(app.backend.getFgAt(new Point(gw, 0))).toBe(editor.resolvedStyle.fg);
        expect(app.backend.getFgAt(new Point(gw, 0))).not.toBe(packRgb(255, 0, 0));
        expect(app.backend.getBgAt(new Point(gw, 0))).toBe(editor.resolvedStyle.bg);
        expect(app.app.screen.getCell(new Point(gw, 0)).style).toBe(StyleFlags.None);
    });

    it("applies token background and all style flags from the metadata", () => {
        // Exercises `resolved.bg !== undefined` plus every flag in packStyleFlags.
        const { app, editor } = createStyledEditor(
            tokenMetadata({ foreground: STYLED_FG_ID, background: STYLED_BG_ID, fontStyle: ALL_FONT_STYLES }),
        );

        const gw = editor.gutterWidth;
        expect(app.backend.getFgAt(new Point(gw, 0))).toBe(STYLED_FG);
        expect(app.backend.getBgAt(new Point(gw, 0))).toBe(STYLED_BG);
        expect(app.app.screen.getCell(new Point(gw, 0)).style).toBe(ALL_STYLE_FLAGS);
    });

    it("skips tokenization when no visual line is in range (zero-height viewport)", () => {
        // With height 0, lastVisibleLogical resolves to -1, so tokenizeViewport is never called.
        const doc = new TextDocument("abc\ndef");
        const viewState = new EditorViewState(doc);
        const store = new DocumentTokenStore(doc, new WholeLineTokenizer(tokenMetadata()));
        const spy = vi.spyOn(store, "tokenizeViewport");
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
