import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { drawSelections } from "../../../../../TestUtils/snippetPane.ts";
import { createRange, type IRange } from "../../../../editor/common/core/iRange.ts";
import { createCursorSelection, createSelection } from "../../../../editor/common/core/iSelection.ts";
import type {
    CompletionItemProvider,
    ICoreCompletionItem,
} from "../../../../editor/common/languages/iCompletionSource.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import {
    createSuggestApp,
    disposeSuggestApp,
    type SuggestContext,
} from "../../../browser/workbench.suggest.testUtils.ts";
import type { TextFileModel } from "../../../services/textfile/common/textFileModel.ts";

import { CompletionServiceDIToken } from "./completionService.ts";

/** Upstream `showSimpleSuggestions`, as a snippet choice uses it: one provider, any selections. */
describe("CompletionService.showSimpleSuggestions", () => {
    let ctx: SuggestContext;

    beforeEach(() => {
        ctx = createSuggestApp("foo\nbar\nfoo");
        ctx.harness.workbench.focusEditor();
    });

    afterEach(() => {
        disposeSuggestApp(ctx);
    });

    function pane(): TextEditorPane<TextFileModel> {
        return ctx.activeEditor() as TextEditorPane<TextFileModel>;
    }

    function provider(items: readonly ICoreCompletionItem[]): CompletionItemProvider & { asked: number } {
        const result = {
            asked: 0,
            triggerCharacters: [],
            provideCompletionItems: () => {
                result.asked++;
                return Promise.resolve({ items, isIncomplete: false });
            },
        };
        return result;
    }

    function item(label: string, range: IRange, extra: Partial<ICoreCompletionItem> = {}): ICoreCompletionItem {
        return { label, insertText: label, range, ...extra };
    }

    function show(simple: CompletionItemProvider): Promise<void> {
        return ctx.harness.container.get(CompletionServiceDIToken).showSimpleSuggestions(simple);
    }

    it("asks the given provider alone, with a selection and several carets", async () => {
        const registered = provider([item("other", createRange(0, 0, 0, 3))]);
        ctx.harness.container.get(LanguageFeaturesServiceDIToken).completionProvider.register("*", registered);
        pane().viewState.selections = [createSelection(0, 0, 0, 3), createSelection(2, 0, 2, 3)];
        const simple = provider([item("one", createRange(0, 0, 0, 3)), item("two", createRange(0, 0, 0, 3))]);
        await show(simple);
        expect(ctx.completion.isOpen()).toBe(true);
        expect(ctx.completion.view.items.map(({ label }) => label)).toEqual(["one", "two"]);
        expect([simple.asked, registered.asked]).toEqual([1, 0]);
    });

    it("no items, no popup: the buffer's words are not offered instead", async () => {
        pane().viewState.selections = [createCursorSelection(2, 1)];
        await show(provider([]));
        expect(ctx.completion.isOpen()).toBe(false);
    });

    it("accept replaces the same text around every caret, a caret with other text there gets its selection replaced", async () => {
        pane().viewState.selections = [
            createSelection(0, 0, 0, 3),
            createCursorSelection(1, 3),
            createSelection(2, 0, 2, 3),
        ];
        await show(provider([item("X", createRange(0, 0, 0, 3))]));
        ctx.testApp.sendKey("Enter");
        expect(drawSelections(pane())).toBe("X|\nbarX|\nX|");
    });

    it("the text replaced around a caret is what the item replaces before and after the primary one", async () => {
        pane().viewState.document.setText("a foo b\nbar\nc foo d");
        pane().viewState.selections = [
            createCursorSelection(0, 3),
            createCursorSelection(1, 3),
            createCursorSelection(2, 3),
        ];
        await show(provider([item("X", createRange(0, 2, 0, 5))]));
        ctx.testApp.sendKey("Enter");
        expect(drawSelections(pane())).toBe("a X| b\nbarX|\nc X| d");
    });

    it("the item's command runs after the insert", async () => {
        const execute = vi.spyOn(ctx.harness.container.get(CommandRegistryDIToken), "execute");
        pane().viewState.selections = [createSelection(0, 0, 0, 3)];
        await show(provider([item("X", createRange(0, 0, 0, 3), { command: { command: "test.after" } })]));
        ctx.testApp.sendKey("Enter");
        expect(execute).not.toHaveBeenCalledWith("test.after");
        await Promise.resolve();
        expect(execute).toHaveBeenCalledWith("test.after");
        expect(pane().viewState.document.getText()).toBe("X\nbar\nfoo");
    });
});
