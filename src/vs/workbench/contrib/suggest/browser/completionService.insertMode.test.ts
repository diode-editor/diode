import { afterEach, describe, expect, it } from "vitest";

import { drawSelections } from "../../../../../TestUtils/snippetPane.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import {
    CompletionItemInsertTextRule,
    type ICoreCompletionItem,
} from "../../../../editor/common/languages/iCompletionSource.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import {
    createSuggestApp,
    disposeSuggestApp,
    type SuggestContext,
} from "../../../browser/workbench.suggest.testUtils.ts";
import type { TextFileModel } from "../../../services/textfile/common/textFileModel.ts";

/** `con|sole`: `inserting` ends at the caret, `replacing` takes the whole word. */
const CONST: ICoreCompletionItem = {
    label: "const",
    insertText: "const",
    range: { insert: createRange(0, 0, 0, 3), replace: createRange(0, 0, 0, 7) },
};

/** Upstream `suggestController`: `editor.suggest.insertMode`, the alternative accept and `adjustWhitespace`. */
describe("CompletionService — insert mode and whitespace", () => {
    let ctx: SuggestContext;

    afterEach(() => {
        disposeSuggestApp(ctx);
    });

    /** `text` with the caret after `caret` characters of its last line. */
    function start(text: string, caret: number): void {
        ctx = createSuggestApp(text);
        ctx.harness.workbench.focusEditor();
        ctx.testApp.sendKey("Ctrl+End");
        ctx.testApp.sendKey("Home");
        // Home on an indented line stops at the first non-whitespace character; a second press goes to column 0.
        if (pane().viewState.selections[0].active.character !== 0) ctx.testApp.sendKey("Home");
        for (let i = 0; i < caret; i++) ctx.testApp.sendKey("ArrowRight");
    }

    function pane(): TextEditorPane<TextFileModel> {
        return ctx.activeEditor() as TextEditorPane<TextFileModel>;
    }

    function register(items: readonly ICoreCompletionItem[]): void {
        ctx.harness.container.get(LanguageFeaturesServiceDIToken).completionProvider.register("*", {
            triggerCharacters: [],
            provideCompletionItems: () => Promise.resolve({ items, isIncomplete: false }),
        });
    }

    async function open(): Promise<void> {
        await ctx.completion.trigger();
        expect(ctx.completion.isOpen()).toBe(true);
    }

    async function setInsertMode(value: "insert" | "replace"): Promise<void> {
        await ctx.harness.container.get(IConfigurationServiceDIToken).updateValue("editor.suggest.insertMode", value);
    }

    function screen(): string {
        ctx.testApp.render();
        return ctx.testApp.backend.screenToString();
    }

    describe("editor.suggest.insertMode", () => {
        it("insert by default — the text right of the caret stays", async () => {
            start("console", 3);
            register([CONST]);
            await open();
            ctx.testApp.sendKey("Enter");
            expect(drawSelections(pane())).toBe("const|sole");
            expect(screen()).toContain("constsole");
        });

        it("replace — the item overwrites the word right of the caret", async () => {
            start("console", 3);
            await setInsertMode("replace");
            register([CONST]);
            await open();
            ctx.testApp.sendKey("Tab");
            expect(drawSelections(pane())).toBe("const|");
            expect(screen()).not.toContain("constsole");
        });

        it("the language's own value of the setting counts", async () => {
            start("console", 3);
            await ctx.harness.container
                .get(IConfigurationServiceDIToken)
                .updateValue(`[${pane().languageId}]`, { "editor.suggest.insertMode": "replace" });
            register([CONST]);
            await open();
            ctx.testApp.sendKey("Enter");
            expect(pane().getText()).toBe("const");
        });

        it("both ranges follow the characters typed after the list opened", async () => {
            start("console", 3);
            register([CONST]);
            await open();
            ctx.testApp.sendKey("s");
            ctx.testApp.sendKey("Enter");
            expect(drawSelections(pane())).toBe("const|sole");
        });

        it("replace after typing takes the whole word, the typed character included", async () => {
            start("console", 3);
            await setInsertMode("replace");
            register([CONST]);
            await open();
            ctx.testApp.sendKey("s");
            ctx.testApp.sendKey("Enter");
            expect(drawSelections(pane())).toBe("const|");
        });

        it("a plain range works the same in both modes", async () => {
            start("console", 3);
            register([{ label: "const", insertText: "const", range: createRange(0, 0, 0, 7) }]);
            await open();
            ctx.testApp.sendKey("Shift+Enter");
            expect(pane().getText()).toBe("const");
        });
    });

    describe("acceptAlternativeSelectedSuggestion", () => {
        it("Shift+Enter in insert mode replaces", async () => {
            start("console", 3);
            register([CONST]);
            await open();
            ctx.testApp.sendKey("Shift+Enter");
            expect(drawSelections(pane())).toBe("const|");
            expect(ctx.completion.isOpen()).toBe(false);
        });

        it("Shift+Tab in insert mode replaces", async () => {
            start("console", 3);
            register([CONST]);
            await open();
            ctx.testApp.sendKey("Shift+Tab");
            expect(pane().getText()).toBe("const");
        });

        it("Shift+Enter in replace mode inserts", async () => {
            start("console", 3);
            await setInsertMode("replace");
            register([CONST]);
            await open();
            ctx.testApp.sendKey("Shift+Enter");
            expect(pane().getText()).toBe("constsole");
        });

        it("Shift+Enter with the list closed is not an accept", () => {
            start("console", 3);
            register([CONST]);
            ctx.testApp.sendKey("Shift+Enter");
            expect(pane().getText()).not.toContain("const");
        });
    });

    describe("whitespace of a multi-line insert text", () => {
        const BLOCK = "if (x) {\n    run();\n}";

        it("lines 2+ get the indentation of the current line", async () => {
            start("        i", 9);
            register([{ label: "if", insertText: BLOCK }]);
            await open();
            ctx.testApp.sendKey("Enter");
            expect(pane().getText()).toBe("        if (x) {\n            run();\n        }");
            expect(screen()).toContain("            run();");
        });

        it("keepWhitespace — the text goes in as is", async () => {
            start("        i", 9);
            register([
                { label: "if", insertText: BLOCK, insertTextRules: CompletionItemInsertTextRule.KeepWhitespace },
            ]);
            await open();
            ctx.testApp.sendKey("Enter");
            expect(pane().getText()).toBe(`        ${BLOCK}`);
        });

        it("the indentation follows the editor's tab settings", async () => {
            start("\ti", 2);
            pane().setIndentOptions({ insertSpaces: false, tabSize: 4 });
            register([{ label: "if", insertText: BLOCK }]);
            await open();
            ctx.testApp.sendKey("Enter");
            expect(pane().getText()).toBe("\tif (x) {\n\t\trun();\n\t}");
        });
    });
});
