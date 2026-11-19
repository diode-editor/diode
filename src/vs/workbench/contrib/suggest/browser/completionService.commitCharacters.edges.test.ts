import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { drawSelections } from "../../../../../TestUtils/snippetPane.ts";
import type {
    CompletionItemProvider,
    ICompletionRequest,
    ICoreCompletionItem,
    ICoreResolvedCompletion,
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

/** Edge cases of upstream `CommitCharacterController` seen from the user's side. */
describe("CompletionService — commit characters, edge cases", () => {
    let ctx: SuggestContext;

    beforeEach(() => {
        ctx = createSuggestApp("consol");
        ctx.harness.workbench.focusEditor();
        ctx.testApp.sendKey("End");
    });

    afterEach(() => {
        disposeSuggestApp(ctx);
    });

    function pane(): TextEditorPane<TextFileModel> {
        return ctx.activeEditor() as TextEditorPane<TextFileModel>;
    }

    function register(
        items: readonly ICoreCompletionItem[],
        options: {
            triggerCharacters?: readonly string[];
            members?: readonly ICoreCompletionItem[];
            resolve?: (id: string) => Promise<ICoreResolvedCompletion | null>;
        } = {},
    ): void {
        const provider = {
            triggerCharacters: options.triggerCharacters ?? [],
            provideCompletionItems: (request: ICompletionRequest) => {
                const answer = request.triggerCharacter === undefined ? items : (options.members ?? []);
                return Promise.resolve({ items: answer, isIncomplete: false });
            },
            ...(options.resolve !== undefined ? { resolveCompletionItem: options.resolve } : {}),
        } satisfies CompletionItemProvider;
        ctx.harness.container.get(LanguageFeaturesServiceDIToken).completionProvider.register("*", provider);
    }

    function consoleItem(extra: Partial<ICoreCompletionItem> = {}): ICoreCompletionItem {
        return { label: "console", insertText: "console", commitCharacters: [".", ";"], ...extra };
    }

    async function open(): Promise<void> {
        await ctx.completion.trigger();
        expect(ctx.completion.isOpen()).toBe(true);
    }

    it("pasting a commit character does not accept the item", async () => {
        register([consoleItem()]);
        await open();
        ctx.testApp.backend.sendPaste(".");
        expect(pane().getText()).toBe("consol.");
    });

    it("turning the setting off while the list is open takes effect on the next character", async () => {
        register([consoleItem()]);
        await open();
        await ctx.harness.container
            .get(IConfigurationServiceDIToken)
            .updateValue("editor.acceptSuggestionOnCommitCharacter", false);
        ctx.testApp.sendKey(".");
        expect(pane().getText()).toBe("consol.");
    });

    it("an empty commit character accepts nothing", async () => {
        register([consoleItem({ commitCharacters: [""] })]);
        await open();
        ctx.testApp.sendKey(".");
        expect(pane().getText()).toBe("consol.");
    });

    it("a multi-character commit string accepts on its first character", async () => {
        register([consoleItem({ commitCharacters: ["::"] })]);
        await open();
        ctx.testApp.sendKey(":");
        expect(pane().getText()).toBe("console:");
    });

    it("space as a commit character", async () => {
        register([consoleItem({ commitCharacters: [" "] })]);
        await open();
        ctx.testApp.sendKey(" ");
        expect(pane().getText()).toBe("console ");
    });

    it("refilter, then the commit character accepts", async () => {
        register([consoleItem(), { label: "consolidate", insertText: "consolidate" }]);
        await open();
        ctx.testApp.sendKey("e");
        expect(ctx.completion.isOpen()).toBe(true);
        ctx.testApp.sendKey(".");
        expect(pane().getText()).toBe("console.");
    });

    it("two dots in a row: the first accepts, the second is typed", async () => {
        register([consoleItem()], { triggerCharacters: ["."], members: [{ label: "log", insertText: "log" }] });
        await open();
        ctx.testApp.sendKey(".");
        ctx.testApp.sendKey(".");
        expect(pane().getText()).toBe("console..");
    });

    it("a failed late resolve leaves the text and the next accept works", async () => {
        const errors: unknown[] = [];
        const onError = (e: unknown): void => {
            errors.push(e);
        };
        process.on("unhandledRejection", onError);
        try {
            register([consoleItem({ id: "1" }), { label: "consolidate", insertText: "consolidate", id: "2" }], {
                resolve: () => Promise.reject(new Error("server died")),
            });
            await open();
            ctx.testApp.sendKey(".");
            await new Promise((r) => setTimeout(r, 20));
            expect(pane().getText()).toBe("console.");
            ctx.testApp.sendKey("Enter");
            ctx.testApp.sendKey("x");
            ctx.testApp.sendKey("Backspace");
            await new Promise((r) => setTimeout(r, 20));
            expect(errors).toEqual([]);
        } finally {
            process.off("unhandledRejection", onError);
        }
    });

    it("Enter still accepts an item with commit characters", async () => {
        register([consoleItem()]);
        await open();
        ctx.testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(drawSelections(pane())).toBe("console|");
        });
    });

    it("Tab still accepts an item with commit characters", async () => {
        register([consoleItem()]);
        await open();
        ctx.testApp.sendKey("Tab");
        await vi.waitFor(() => {
            expect(drawSelections(pane())).toBe("console|");
        });
    });
});
