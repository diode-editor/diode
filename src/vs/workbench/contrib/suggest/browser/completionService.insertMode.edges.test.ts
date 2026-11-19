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

describe("CompletionService — insert mode and whitespace, edges", () => {
    let ctx: SuggestContext;

    afterEach(() => {
        disposeSuggestApp(ctx);
    });

    function start(text: string, caret: number): void {
        ctx = createSuggestApp(text);
        ctx.harness.workbench.focusEditor();
        ctx.testApp.sendKey("Ctrl+End");
        ctx.testApp.sendKey("Home");
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

    it("caret at the end of the word: insert gives the item, nothing more", async () => {
        start("cons", 4);
        register([
            {
                label: "const",
                insertText: "const",
                range: { insert: createRange(0, 0, 0, 4), replace: createRange(0, 0, 0, 4) },
            },
        ]);
        await open();
        ctx.testApp.sendKey("Enter");
        expect(drawSelections(pane())).toBe("const|");
    });

    it.each(["Enter", "Shift+Enter"])("no range: %s replaces only the prefix", async (key) => {
        start("console", 3);
        register([{ label: "const", insertText: "const" }]);
        await open();
        ctx.testApp.sendKey(key);
        expect(pane().getText()).toBe("constsole");
    });

    it("setting changed between two accepts applies to the second", async () => {
        start("console", 3);
        register([
            {
                label: "const",
                insertText: "const",
                range: { insert: createRange(0, 0, 0, 3), replace: createRange(0, 0, 0, 7) },
            },
        ]);
        await open();
        ctx.testApp.sendKey("Enter");
        expect(pane().getText()).toBe("constsole");
        ctx.testApp.sendKey("Ctrl+Z");
        expect(pane().getText()).toBe("console");
        await setInsertMode("replace");
        await open();
        ctx.testApp.sendKey("Enter");
        expect(pane().getText()).toBe("const");
    });

    it("additionalEdits still apply with insert ranges", async () => {
        start("x\ncon", 3);
        register([
            {
                label: "const",
                insertText: "const",
                range: { insert: createRange(1, 0, 1, 3), replace: createRange(1, 0, 1, 3) },
                additionalEdits: [{ range: createRange(0, 0, 0, 0), text: "import y;\n" }],
            },
        ]);
        await open();
        ctx.testApp.sendKey("Enter");
        expect(pane().getText()).toBe("import y;\nx\nconst");
    });

    it("an empty line of the insert text gets the indentation too (upstream)", async () => {
        start("    i", 5);
        register([{ label: "if", insertText: "a\n\nb" }]);
        await open();
        ctx.testApp.sendKey("Enter");
        expect(pane().getText()).toBe("    a\n    \n    b");
    });

    it("the first line is normalized to the editor's indentation", async () => {
        start("i", 1);
        pane().setIndentOptions({ insertSpaces: true, tabSize: 4 });
        register([{ label: "if", insertText: "\tif\n\tx" }]);
        await open();
        ctx.testApp.sendKey("Enter");
        expect(pane().getText()).toBe("    if\n    x");
    });

    it("a tab-indented line in a spaces editor: lines 2+ get spaces", async () => {
        start("\ti", 2);
        pane().setIndentOptions({ insertSpaces: true, tabSize: 4 });
        register([{ label: "if", insertText: "if {\n}" }]);
        await open();
        ctx.testApp.sendKey("Enter");
        expect(pane().getText()).toBe("\tif {\n    }");
    });

    it("indentation is the line's leading whitespace, not up to the caret", async () => {
        start("    foo(i", 9);
        register([{ label: "if", insertText: "a\nb" }]);
        await open();
        ctx.testApp.sendKey("Enter");
        expect(pane().getText()).toBe("    foo(a\n    b");
    });

    it("CRLF inside the insert text does not leave a stray CR", async () => {
        start("    i", 5);
        register([{ label: "if", insertText: "a\r\nb" }]);
        await open();
        ctx.testApp.sendKey("Enter");
        expect(pane().getText()).toBe("    a\n    b");
    });

    it("keepWhitespace with CRLF still uses the document EOL", async () => {
        start("    i", 5);
        register([{ label: "if", insertText: "a\r\nb", insertTextRules: CompletionItemInsertTextRule.KeepWhitespace }]);
        await open();
        ctx.testApp.sendKey("Enter");
        expect(pane().getText()).toBe("    a\nb");
    });

    it("multi-line accept is one undo step", async () => {
        start("    i", 5);
        register([{ label: "if", insertText: "a\nb" }]);
        await open();
        ctx.testApp.sendKey("Enter");
        ctx.testApp.sendKey("Ctrl+Z");
        expect(pane().getText()).toBe("    i");
    });

    it("insert range with typed characters past the original word end", async () => {
        start("con", 3);
        register([
            {
                label: "const",
                insertText: "const",
                range: { insert: createRange(0, 0, 0, 3), replace: createRange(0, 0, 0, 3) },
            },
        ]);
        await open();
        ctx.testApp.sendKey("s");
        ctx.testApp.sendKey("Shift+Enter");
        expect(drawSelections(pane())).toBe("const|");
    });

    it("caret after multi-line insert is at the end of the inserted text", async () => {
        start("    i", 5);
        register([{ label: "if", insertText: "a\nb" }]);
        await open();
        ctx.testApp.sendKey("Enter");
        expect(drawSelections(pane())).toBe("    a\n    b|");
    });
});
