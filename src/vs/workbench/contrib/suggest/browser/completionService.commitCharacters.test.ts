import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { drawSelections } from "../../../../../TestUtils/snippetPane.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type {
    CompletionItemProvider,
    ICompletionRequest,
    ICoreCompletionItem,
    ICoreResolvedCompletion,
} from "../../../../editor/common/languages/iCompletionSource.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import {
    createSuggestApp,
    disposeSuggestApp,
    type SuggestContext,
} from "../../../browser/workbench.suggest.testUtils.ts";
import type { TextFileModel } from "../../../services/textfile/common/textFileModel.ts";

import { CompletionServiceDIToken } from "./completionService.ts";

const IMPORT = createTextEdit(createRange(0, 0, 0, 0), "import x;\n");

/** Upstream `CommitCharacterController`: a commit character of the selected item accepts it, then is typed. */
describe("CompletionService — commit characters", () => {
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
    ): CompletionItemProvider & { requests: ICompletionRequest[] } {
        const provider = {
            requests: [] as ICompletionRequest[],
            triggerCharacters: options.triggerCharacters ?? [],
            provideCompletionItems: (request: ICompletionRequest) => {
                provider.requests.push(request);
                const answer = request.triggerCharacter === undefined ? items : (options.members ?? []);
                return Promise.resolve({ items: answer, isIncomplete: false });
            },
            ...(options.resolve !== undefined ? { resolveCompletionItem: options.resolve } : {}),
        };
        ctx.harness.container.get(LanguageFeaturesServiceDIToken).completionProvider.register("*", provider);
        return provider;
    }

    function consoleItem(extra: Partial<ICoreCompletionItem> = {}): ICoreCompletionItem {
        return { label: "console", insertText: "console", commitCharacters: [".", ";"], ...extra };
    }

    async function open(): Promise<void> {
        await ctx.completion.trigger();
        expect(ctx.completion.isOpen()).toBe(true);
    }

    function screen(): string {
        ctx.testApp.render();
        return ctx.testApp.backend.screenToString();
    }

    it("a commit character of the selected item accepts it and is typed after the inserted text", async () => {
        register([consoleItem()]);
        await open();
        ctx.testApp.sendKey(".");
        expect(drawSelections(pane())).toBe("console.|");
        expect(ctx.completion.isOpen()).toBe(false);
        expect(screen()).toContain("console.");
    });

    it("the accept and the character are two undo steps", async () => {
        register([consoleItem()]);
        await open();
        ctx.testApp.sendKey(";");
        expect(pane().getText()).toBe("console;");
        ctx.testApp.sendKey("Ctrl+Z");
        expect(pane().getText()).toBe("console");
        ctx.testApp.sendKey("Ctrl+Z");
        expect(pane().getText()).toBe("consol");
    });

    it("a character that is not a commit character of the selected item is typed and refilters the list", async () => {
        register([consoleItem(), { label: "consol_x", insertText: "consol_x" }]);
        await open();
        ctx.testApp.sendKey("_");
        expect(pane().getText()).toBe("consol_");
        expect(ctx.completion.isOpen()).toBe(true);
        expect(ctx.completion.view.items.map(({ label }) => label)).toEqual(["consol_x"]);
    });

    it("only the selected item's commit characters count", async () => {
        register([consoleItem(), { label: "consolidate", insertText: "consolidate" }]);
        await open();
        ctx.testApp.sendKey("ArrowDown");
        expect(ctx.completion.view.getSelectedItem()?.label).toBe("consolidate");
        ctx.testApp.sendKey(".");
        expect(pane().getText()).toBe("consol.");
    });

    it("editor.acceptSuggestionOnCommitCharacter: false — the character is just typed", async () => {
        await ctx.harness.container
            .get(IConfigurationServiceDIToken)
            .updateValue("editor.acceptSuggestionOnCommitCharacter", false);
        register([consoleItem()]);
        await open();
        ctx.testApp.sendKey(".");
        expect(pane().getText()).toBe("consol.");
    });

    it("the language's own value of the setting counts", async () => {
        await ctx.harness.container
            .get(IConfigurationServiceDIToken)
            .updateValue(`[${pane().languageId}]`, { "editor.acceptSuggestionOnCommitCharacter": false });
        register([consoleItem()]);
        await open();
        ctx.testApp.sendKey(".");
        expect(pane().getText()).toBe("consol.");
    });

    it("the first character of a longer commit character accepts", async () => {
        register([consoleItem({ commitCharacters: ["->"] })]);
        await open();
        ctx.testApp.sendKey("-");
        expect(pane().getText()).toBe("console-");
    });

    it("typing before any list was shown is just typing", () => {
        ctx.testApp.sendKey(".");
        expect(pane().getText()).toBe("consol.");
    });

    it("no character accepts with the popup closed", async () => {
        register([consoleItem()]);
        await open();
        ctx.testApp.sendKey("Escape");
        ctx.testApp.sendKey(".");
        expect(pane().getText()).toBe("consol.");
    });

    it("a commit character that is also a trigger character opens the new list after the accept", async () => {
        const provider = register([consoleItem()], {
            triggerCharacters: ["."],
            members: [{ label: "log", insertText: "log" }],
        });
        await open();
        ctx.testApp.sendKey(".");
        expect(pane().getText()).toBe("console.");
        await vi.waitFor(() => {
            expect(ctx.completion.view.items.map(({ label }) => label)).toEqual(["log"]);
        });
        expect(provider.requests.at(-1)).toMatchObject({ character: 8, triggerCharacter: "." });
    });

    it("the edits that came in the list and the command go with the accept", async () => {
        const execute = vi.spyOn(ctx.harness.container.get(CommandRegistryDIToken), "execute");
        register([consoleItem({ additionalEdits: [IMPORT], command: { command: "test.after", arguments: [1] } })]);
        await open();
        ctx.testApp.sendKey(".");
        expect(pane().getText()).toBe("import x;\nconsole.");
        await Promise.resolve();
        expect(execute).toHaveBeenCalledWith("test.after", 1);
        ctx.testApp.sendKey("Ctrl+Z");
        ctx.testApp.sendKey("Ctrl+Z");
        expect(pane().getText()).toBe("consol");
    });

    it("the edits resolve already brought go in with the accept", async () => {
        const resolve = vi.fn(() => Promise.resolve({ additionalEdits: [IMPORT] }));
        register([consoleItem({ id: "1" })], { resolve });
        await open();
        // Showing the details resolves the item.
        ctx.harness.container.get(CompletionServiceDIToken).toggleDetails();
        await vi.waitFor(() => {
            expect(resolve).toHaveBeenCalledTimes(1);
        });
        await Promise.resolve();
        ctx.testApp.sendKey(".");
        expect(pane().getText()).toBe("import x;\nconsole.");
        // Nothing follows later either.
        await new Promise((done) => setTimeout(done));
        expect(pane().getText()).toBe("import x;\nconsole.");
        expect(resolve).toHaveBeenCalledTimes(1);
    });

    describe("the edits of a resolve still to come", () => {
        function deferredResolve(): {
            resolve: (id: string) => Promise<ICoreResolvedCompletion | null>;
            answer: (resolved: ICoreResolvedCompletion | null) => Promise<void>;
        } {
            let answer: (resolved: ICoreResolvedCompletion | null) => void = () => undefined;
            const pending = new Promise<ICoreResolvedCompletion | null>((resolve) => {
                answer = resolve;
            });
            return {
                resolve: () => pending,
                answer: async (resolved) => {
                    answer(resolved);
                    await pending;
                    await Promise.resolve();
                },
            };
        }

        it("do not hold the insertion and follow as their own undo step", async () => {
            const server = deferredResolve();
            register([consoleItem({ id: "1" })], { resolve: server.resolve });
            await open();
            ctx.testApp.sendKey(".");
            expect(drawSelections(pane())).toBe("console.|");
            const apply = vi.spyOn(pane(), "applyExternalEdits");
            await server.answer({ additionalEdits: [IMPORT] });
            expect(drawSelections(pane())).toBe("import x;\nconsole.|");
            expect(apply).toHaveBeenCalledWith([IMPORT], "Accept Completion");
            ctx.testApp.sendKey("Ctrl+Z");
            expect(pane().getText()).toBe("console.");
        });

        it("a change before an edit's start drops the edits", async () => {
            const server = deferredResolve();
            register([consoleItem({ id: "1" })], { resolve: server.resolve });
            await open();
            ctx.testApp.sendKey(";");
            await server.answer({ additionalEdits: [createTextEdit(createRange(0, 8, 0, 8), " // x")] });
            expect(pane().getText()).toBe("console;");
        });

        it("one edit after a change drops them all", async () => {
            const server = deferredResolve();
            register([consoleItem({ id: "1" })], { resolve: server.resolve });
            await open();
            ctx.testApp.sendKey(";");
            await server.answer({
                additionalEdits: [IMPORT, createTextEdit(createRange(0, 8, 0, 8), " // x")],
            });
            expect(pane().getText()).toBe("console;");
        });

        it("no answer from resolve — nothing more happens", async () => {
            const server = deferredResolve();
            register([consoleItem({ id: "1" })], { resolve: server.resolve });
            await open();
            ctx.testApp.sendKey(".");
            await server.answer(null);
            expect(pane().getText()).toBe("console.");
        });

        it("a later change does not hide an earlier one", async () => {
            const server = deferredResolve();
            register([consoleItem({ id: "1" })], { resolve: server.resolve });
            await open();
            ctx.testApp.sendKey(";");
            ctx.testApp.sendKey("x");
            await server.answer({ additionalEdits: [createTextEdit(createRange(0, 8, 0, 8), " // x")] });
            expect(pane().getText()).toBe("console;x");
        });

        it("an edit before every change since the insertion is applied", async () => {
            pane().viewState.document.setText("\nconsol");
            pane().viewState.selections = [createCursorSelection(1, 6)];
            const server = deferredResolve();
            register([consoleItem({ id: "1" })], { resolve: server.resolve });
            await open();
            ctx.testApp.sendKey(".");
            // A change at the edit's very position, not before it: the edit still applies.
            pane().applyExternalEdits([createTextEdit(createRange(0, 0, 0, 0), "// a")], "test");
            await server.answer({ additionalEdits: [createTextEdit(createRange(0, 0, 0, 0), "import x;")] });
            expect(pane().getText()).toBe("import x;// a\nconsole.");
        });

        it("a reload of the text drops the edits", async () => {
            const server = deferredResolve();
            register([consoleItem({ id: "1" })], { resolve: server.resolve });
            await open();
            ctx.testApp.sendKey(".");
            pane().viewState.document.setText("reloaded");
            await server.answer({ additionalEdits: [IMPORT] });
            expect(pane().getText()).toBe("reloaded");
        });

        it("no edits in the answer — nothing more happens", async () => {
            const server = deferredResolve();
            register([consoleItem({ id: "1" })], { resolve: server.resolve });
            await open();
            ctx.testApp.sendKey(".");
            await server.answer({ detail: "x" });
            expect(pane().getText()).toBe("console.");
            ctx.testApp.sendKey("Ctrl+Z");
            expect(pane().getText()).toBe("console");
        });
    });

    it("several carets: the item goes in at each, then the character", async () => {
        pane().viewState.document.setText("consol\nconsol");
        pane().viewState.selections = [createCursorSelection(0, 6), createCursorSelection(1, 6)];
        const simple: CompletionItemProvider = {
            triggerCharacters: [],
            provideCompletionItems: () =>
                Promise.resolve({ items: [consoleItem({ range: createRange(0, 0, 0, 6) })], isIncomplete: false }),
        };
        await ctx.harness.container.get(CompletionServiceDIToken).showSimpleSuggestions(simple);
        ctx.testApp.sendKey(".");
        expect(drawSelections(pane())).toBe("console.|\nconsole.|");
    });
});
