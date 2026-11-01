import { describe, expect, it } from "vitest";

import { createCursorSelection, createSelection } from "../core/iSelection.ts";
import { resolveLanguageConfiguration } from "../languages/languageConfiguration.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

describe("EditorViewState.insertNewLine — onEnterRules", () => {
    function state(text: string, selection = createCursorSelection(1, 1)) {
        return new EditorViewState(new TextDocument(text), [selection]);
    }

    it("the rule sees the previous line, the text before the cursor and the text after it", () => {
        const rules = resolveLanguageConfiguration({
            onEnterRules: [
                {
                    beforeText: "^b$",
                    afterText: "^c$",
                    previousLineText: "^a$",
                    action: { indent: "none", appendText: "!" },
                },
            ],
        }).onEnterRules;
        const view = state("a\nbc");
        view.insertNewLine(rules);
        expect(view.document.getText()).toBe("a\nb\n!c");
    });

    it("the text after a multiline selection comes from its last line; the first line has no previous one", () => {
        const rules = resolveLanguageConfiguration({
            onEnterRules: [
                {
                    beforeText: "^a$",
                    afterText: "^z$",
                    previousLineText: "^$",
                    action: { indent: "none", appendText: "!" },
                },
            ],
        }).onEnterRules;
        const view = state("ab\nyz", createSelection(0, 1, 1, 1));
        view.insertNewLine(rules);
        expect(view.document.getText()).toBe("a\n!z");
    });

    it("the cursor lands after the appended text", () => {
        const rules = resolveLanguageConfiguration({
            onEnterRules: [{ beforeText: "^//", action: { indent: "none", appendText: "// " } }],
        }).onEnterRules;
        const view = state("// a", createCursorSelection(0, 4));
        view.insertNewLine(rules);
        expect(view.selections[0].active).toEqual({ line: 1, character: 3 });
    });
});
