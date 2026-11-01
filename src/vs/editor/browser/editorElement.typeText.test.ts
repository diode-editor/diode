import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { describe, expect, it } from "vitest";

import { currentCursorChangeSource } from "../common/core/cursorChangeSource.ts";
import { createCursorSelection, createSelection } from "../common/core/iSelection.ts";
import {
    EMPTY_LANGUAGE_CONFIGURATION,
    resolveLanguageConfiguration,
} from "../common/languages/languageConfiguration.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

const CONFIG = resolveLanguageConfiguration({
    autoClosingPairs: [{ open: "(", close: ")" }],
    surroundingPairs: [["(", ")"]],
    onEnterRules: [{ beforeText: "^// ", action: { indent: "none", appendText: "// " } }],
});

function makeEditor(text: string, selections = [createCursorSelection(0, 0)]) {
    const viewState = new EditorViewState(new TextDocument(text), selections);
    viewState.viewportWidth = 80;
    viewState.viewportHeight = 20;
    const editor = new EditorElement(viewState);
    editor.languageConfigurationSource = () => CONFIG;
    const typed: string[] = [];
    editor.onDidType((char) => typed.push(char));
    return { editor, viewState, typed };
}

describe("EditorElement.typeText", () => {
    it("auto-closes, types over and surrounds, as the keyboard does", () => {
        const { editor, viewState } = makeEditor("");
        editor.typeText("f(");
        expect(viewState.document.getText()).toBe("f()");
        editor.typeText(")");
        expect(viewState.document.getText()).toBe("f()");
        expect(viewState.selections[0].active).toEqual({ line: 0, character: 3 });

        const surrounded = makeEditor("word", [createSelection(0, 0, 0, 4)]);
        surrounded.editor.typeText("(");
        expect(surrounded.viewState.document.getText()).toBe("(word)");
    });

    it("interprets each character: a line break inside the text goes through Enter", () => {
        const { editor, viewState } = makeEditor("  ", [createCursorSelection(0, 2)]);
        editor.typeText("a\nb");
        expect(viewState.document.getText()).toBe("  a\n  b");
    });

    it.each([
        ["\\r\\n", "a\r\nb"],
        ["\\r", "a\rb"],
    ])("%s counts as one line break", (_name, text) => {
        const { editor, viewState, typed } = makeEditor("");
        editor.typeText(text);
        expect(viewState.document.getText()).toBe("a\nb");
        expect(typed).toEqual(["a", "b"]);
    });

    it("keeps a character outside the BMP whole", () => {
        const { editor, viewState, typed } = makeEditor("");
        editor.typeText("🙂");
        expect(viewState.document.getText()).toBe("🙂");
        expect(typed).toEqual(["🙂"]);
    });

    it("onDidType fires per character, as for keys, and not for a line break, as for Enter", () => {
        const { editor, typed } = makeEditor("");
        editor.typeText("a.\nb");
        expect(typed).toEqual(["a", ".", "b"]);
    });

    it("a read-only editor stays as is and reports no typing", () => {
        const { editor, viewState, typed } = makeEditor("x");
        viewState.readOnly = true;
        editor.typeText("a\nb");
        expect(viewState.document.getText()).toBe("x");
        expect(typed).toEqual([]);
    });

    it("the cursor change reads as keyboard", () => {
        const { editor, viewState } = makeEditor("");
        const sources: unknown[] = [];
        viewState.onDidChangeCursorPosition(() => sources.push(currentCursorChangeSource()));
        editor.typeText("a");
        expect(sources.length).toBeGreaterThan(0);
        expect(new Set(sources)).toEqual(new Set(["keyboard"]));
    });

    it("the Enter key applies the language's onEnterRules", () => {
        const { editor, viewState } = makeEditor("// note", [createCursorSelection(0, 7)]);
        editor.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "Enter" }));
        expect(viewState.document.getText()).toBe("// note\n// ");
    });

    it("no configuration yet: a plain line break", () => {
        const { editor, viewState } = makeEditor("// note", [createCursorSelection(0, 7)]);
        editor.languageConfigurationSource = () => undefined;
        editor.typeText("\n");
        expect(viewState.document.getText()).toBe("// note\n");
        editor.languageConfigurationSource = () => EMPTY_LANGUAGE_CONFIGURATION;
        editor.typeText("\n");
        expect(viewState.document.getText()).toBe("// note\n\n");
    });

    it("undo takes the typed text back", () => {
        const { editor, viewState } = makeEditor("");
        editor.typeText("abc");
        while (viewState.document.getText() !== "") {
            editor.undoManager.undo(viewState);
        }
        expect(viewState.selections[0].active).toEqual({ line: 0, character: 0 });
    });
});
