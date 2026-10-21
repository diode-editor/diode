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
    it("printable character: the event fires after the edit, text already in place", () => {
        const { editor, typed } = makeEditor("fo");
        press(editor, "o");
        expect(typed).toEqual([{ text: "o", documentAtFire: "foo" }]);
    });

    it("auto-close: the typed `(` is reported though `()` is inserted", () => {
        const { editor, typed } = makeEditor("f");
        press(editor, "(");
        expect(typed).toEqual([{ text: "(", documentAtFire: "f()" }]);
    });

    it("typeover: `)` is reported though the text is unchanged", () => {
        const { editor, typed } = makeEditor("f");
        press(editor, "(");
        press(editor, ")");
        expect(typed.map((t) => t.text)).toEqual(["(", ")"]);
        expect(typed[1].documentAtFire).toBe("f()");
    });

    it("auto-surround of a selection is typing too", () => {
        const { editor, typed } = makeEditor("ab", [createSelection(0, 0, 0, 2)]);
        press(editor, "(");
        expect(typed).toEqual([{ text: "(", documentAtFire: "(ab)" }]);
    });

    it("Enter, paste, shortcuts and non-keyboard edits do not count as typing", () => {
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

    it("read-only: no edit — no event", () => {
        const { editor, viewState, typed } = makeEditor("x");
        viewState.readOnly = true;
        press(editor, "a");
        expect(typed).toEqual([]);
    });

    it("dispose removes the listener; a listener may dispose a neighbour mid-dispatch", () => {
        const { editor, typed, subscription } = makeEditor("");
        const seen: string[] = [];
        let neighbour = { dispose: (): void => undefined };
        editor.onDidType(() => {
            neighbour.dispose();
        });
        neighbour = editor.onDidType((text) => seen.push(text));
        // A neighbour disposed mid-dispatch and not yet reached no longer receives the current
        // character (Emitter guarantee, docs/arch/Common.md#события-eventts, G2).
        press(editor, "a");
        press(editor, "b");
        expect(seen).toEqual([]);

        const last: string[] = [];
        editor.onDidType((text) => last.push(text));
        subscription.dispose();
        // Disposing twice is harmless and removes no other listeners (including the last one in the list).
        subscription.dispose();
        press(editor, "c");
        expect(typed.map((t) => t.text)).toEqual(["a", "b"]);
        expect(last).toEqual(["c"]);
    });
});
