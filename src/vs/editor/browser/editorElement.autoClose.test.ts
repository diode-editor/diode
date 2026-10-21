import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { describe, expect, it } from "vitest";

import { createCursorSelection, createSelection } from "../common/core/iSelection.ts";
import {
    EMPTY_LANGUAGE_CONFIGURATION,
    type IResolvedLanguageConfiguration,
} from "../common/languages/languageConfiguration.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

const TS_LIKE: IResolvedLanguageConfiguration = {
    ...EMPTY_LANGUAGE_CONFIGURATION,
    autoClosingPairs: [
        { open: "{", close: "}", notIn: [] },
        { open: "'", close: "'", notIn: [] },
    ],
    surroundingPairs: [
        ["{", "}"],
        ["'", "'"],
    ],
};

function makeEditor(text: string, selections = [createCursorSelection(0, 0)]) {
    const viewState = new EditorViewState(new TextDocument(text), selections);
    viewState.viewportWidth = 80;
    viewState.viewportHeight = 20;
    const editor = new EditorElement(viewState);
    editor.languageConfigurationSource = () => TS_LIKE;
    return { editor, viewState };
}

function press(editor: EditorElement, key: string): void {
    editor.dispatchEvent(new TUIKeyboardEvent("keypress", { key }));
}

describe("EditorElement — авто-закрытие при наборе", () => {
    it("открывающая скобка вставляет пару с кареткой внутри", () => {
        const { editor, viewState } = makeEditor("");
        press(editor, "{");
        expect(viewState.document.getText()).toBe("{}");
        expect(viewState.selections[0].active).toEqual({ line: 0, character: 1 });
    });

    it("закрывающая под кареткой перешагивается: {} набирается как {} а не {}}", () => {
        const { editor, viewState } = makeEditor("");
        press(editor, "{");
        press(editor, "}");
        expect(viewState.document.getText()).toBe("{}");
        expect(viewState.selections[0].active).toEqual({ line: 0, character: 2 });
    });

    it("typeover не пишет шаг в undo (нечего отменять)", () => {
        const { editor, viewState } = makeEditor("");
        press(editor, "{");
        press(editor, "}");
        editor.undoManager.undo(viewState);
        expect(viewState.document.getText()).toBe("");
    });

    it("скобка посреди слова набирается как обычный символ", () => {
        const { editor, viewState } = makeEditor("word", [createCursorSelection(0, 2)]);
        press(editor, "{");
        expect(viewState.document.getText()).toBe("wo{rd");
    });

    it("без источника конфигурации — обычный набор", () => {
        const { editor, viewState } = makeEditor("");
        editor.languageConfigurationSource = null;
        press(editor, "{");
        expect(viewState.document.getText()).toBe("{");
    });

    it("источник ещё не загрузил язык (undefined) — обычный набор", () => {
        const { editor, viewState } = makeEditor("");
        editor.languageConfigurationSource = () => undefined;
        press(editor, "{");
        expect(viewState.document.getText()).toBe("{");
    });

    it("мультикурсор с одинаковым контекстом закрывает у всех кареток", () => {
        const { editor, viewState } = makeEditor("a\nb", [createCursorSelection(0, 1), createCursorSelection(1, 1)]);
        press(editor, "{");
        expect(viewState.document.getText()).toBe("a{}\nb{}");
    });

    it("typeover только у части кареток — набирается обычный символ у всех", () => {
        // The first cursor is before `}` (would type over), the second is inside text.
        const { editor, viewState } = makeEditor("{}\nab", [createCursorSelection(0, 1), createCursorSelection(1, 1)]);
        press(editor, "}");
        expect(viewState.document.getText()).toBe("{}}\na}b");
    });

    it("каретки, которым подошли РАЗНЫЕ пары, откатываются к обычному набору", () => {
        // `*` after `/*` opens `/**` → ` */`, while `*` in empty space gets its own
        // pair: the closing parts differ, so there is no single decision.
        const { editor, viewState } = makeEditor("/*\nab", [
            createCursorSelection(0, 2),
            // End of line: the pair fires here too, but a different one.
            createCursorSelection(1, 2),
        ]);
        editor.languageConfigurationSource = () => ({
            ...EMPTY_LANGUAGE_CONFIGURATION,
            autoClosingPairs: [
                { open: "*", close: "X", notIn: [] },
                { open: "/**", close: " */", notIn: [] },
            ],
        });
        press(editor, "*");
        expect(viewState.document.getText()).toBe("/**\nab*");
    });

    it("каретки с разъехавшимся контекстом откатываются к обычному набору", () => {
        // The first cursor is at the end of a line (would insert a pair), the second is mid-word
        // (plain typing): the decisions disagree, so the character is typed as is.
        const { editor, viewState } = makeEditor("a\nword", [createCursorSelection(0, 1), createCursorSelection(1, 2)]);
        press(editor, "{");
        expect(viewState.document.getText()).toBe("a{\nwo{rd");
    });
});

describe("EditorElement — auto-surround выделения", () => {
    it("скобка при непустом выделении обрамляет его, а не затирает", () => {
        const { editor, viewState } = makeEditor("const a = 1;", [createSelection(0, 6, 0, 7)]);
        press(editor, "{");
        expect(viewState.document.getText()).toBe("const {a} = 1;");
        expect(viewState.getSelectedText()).toBe("a");
    });

    it("кавычка обрамляет каждое из нескольких выделений", () => {
        const { editor, viewState } = makeEditor("aa bb", [createSelection(0, 0, 0, 2), createSelection(0, 3, 0, 5)]);
        press(editor, "'");
        expect(viewState.document.getText()).toBe("'aa' 'bb'");
    });

    it("символ вне surroundingPairs затирает выделение обычным набором", () => {
        const { editor, viewState } = makeEditor("aa", [createSelection(0, 0, 0, 2)]);
        press(editor, "x");
        expect(viewState.document.getText()).toBe("x");
    });

    it("смешанные выделения (пустое + непустое) — обычный набор с заменой", () => {
        const { editor, viewState } = makeEditor("aa b", [createSelection(0, 0, 0, 2), createCursorSelection(0, 3)]);
        press(editor, "{");
        expect(viewState.document.getText()).toBe("{ {b");
    });

    it("смешанные выделения не закрываются парой, даже когда контекст это позволяет", () => {
        // Both participants have "nothing after the cursor" (a space and end of line),
        // so the auto-close decision would be unanimous — but surrounding is not unanimous
        // (only one has a selection), and replacing a selection with a pair is not allowed.
        const { editor, viewState } = makeEditor("aa b", [createSelection(0, 0, 0, 2), createCursorSelection(0, 4)]);
        press(editor, "{");
        expect(viewState.document.getText()).toBe("{ b{");
    });

    it("surround попадает в undo одним шагом", () => {
        const { editor, viewState } = makeEditor("aa", [createSelection(0, 0, 0, 2)]);
        press(editor, "'");
        expect(viewState.document.getText()).toBe("'aa'");
        editor.undoManager.undo(viewState);
        expect(viewState.document.getText()).toBe("aa");
    });
});
