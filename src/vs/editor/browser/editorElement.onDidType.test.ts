import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { TUIPasteEvent } from "@tuidom/core/dom/events/tuiPasteEvent";
import { describe, expect, it } from "vitest";

import { createCursorSelection, createSelection } from "../common/core/iSelection.ts";
import {
    EMPTY_LANGUAGE_CONFIGURATION,
    type IResolvedLanguageConfiguration,
} from "../common/languages/languageConfiguration.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

const PAIRS: IResolvedLanguageConfiguration = {
    ...EMPTY_LANGUAGE_CONFIGURATION,
    autoClosingPairs: [{ open: "(", close: ")", notIn: [] }],
    surroundingPairs: [["(", ")"]],
};

/** Редактор, который пишет каждый `onDidType` вместе с текстом на момент события. */
function makeEditor(text: string, selections = [createCursorSelection(0, text.length)]) {
    const viewState = new EditorViewState(new TextDocument(text), selections);
    viewState.viewportWidth = 80;
    viewState.viewportHeight = 20;
    const editor = new EditorElement(viewState);
    editor.languageConfigurationSource = () => PAIRS;
    const typed: { text: string; documentAtFire: string }[] = [];
    const subscription = editor.onDidType((typedText) => {
        typed.push({ text: typedText, documentAtFire: viewState.document.getText() });
    });
    return { editor, viewState, typed, subscription };
}

function press(editor: EditorElement, key: string, modifiers: { ctrlKey?: boolean; altKey?: boolean } = {}): void {
    editor.dispatchEvent(new TUIKeyboardEvent("keypress", { key, ...modifiers }));
}

describe("EditorElement.onDidType", () => {
    it("печатный символ: событие после правки, текст уже на месте", () => {
        const { editor, typed } = makeEditor("fo");
        press(editor, "o");
        expect(typed).toEqual([{ text: "o", documentAtFire: "foo" }]);
    });

    it("auto-close: набранная `(` приходит событием, хотя вставлено `()`", () => {
        const { editor, typed } = makeEditor("f");
        press(editor, "(");
        expect(typed).toEqual([{ text: "(", documentAtFire: "f()" }]);
    });

    it("typeover: `)` приходит событием, хотя текст не изменился", () => {
        const { editor, typed } = makeEditor("f");
        press(editor, "(");
        press(editor, ")");
        expect(typed.map((t) => t.text)).toEqual(["(", ")"]);
        expect(typed[1].documentAtFire).toBe("f()");
    });

    it("auto-surround выделения — тоже набор", () => {
        const { editor, typed } = makeEditor("ab", [createSelection(0, 0, 0, 2)]);
        press(editor, "(");
        expect(typed).toEqual([{ text: "(", documentAtFire: "(ab)" }]);
    });

    it("Enter, вставка, сочетания и правки мимо клавиатуры набором не считаются", () => {
        const { editor, viewState, typed } = makeEditor("x");
        press(editor, "Enter");
        editor.dispatchEvent(new TUIPasteEvent("y"));
        press(editor, "a", { ctrlKey: true });
        press(editor, "b", { altKey: true });
        viewState.applyEdits(
            [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: "z" }],
            "external",
        );
        expect(typed).toEqual([]);
    });

    it("read-only: правки нет — и события нет", () => {
        const { editor, viewState, typed } = makeEditor("x");
        viewState.readOnly = true;
        press(editor, "a");
        expect(typed).toEqual([]);
    });

    it("отписка снимает слушателя; слушатель вправе отписать соседа посреди рассылки", () => {
        const { editor, typed, subscription } = makeEditor("");
        const seen: string[] = [];
        let neighbour = { dispose: (): void => undefined };
        editor.onDidType(() => {
            neighbour.dispose();
        });
        neighbour = editor.onDidType((text) => seen.push(text));
        // Сосед, отписанный посреди рассылки и ещё не достигнутый, текущий символ
        // уже не получает (гарантия Emitter, docs/TODO/Events.md G2).
        press(editor, "a");
        press(editor, "b");
        expect(seen).toEqual([]);

        const last: string[] = [];
        editor.onDidType((text) => last.push(text));
        subscription.dispose();
        // Повторная отписка безвредна и не снимает чужих (в том числе последнего в списке).
        subscription.dispose();
        press(editor, "c");
        expect(typed.map((t) => t.text)).toEqual(["a", "b"]);
        expect(last).toEqual(["c"]);
    });
});
