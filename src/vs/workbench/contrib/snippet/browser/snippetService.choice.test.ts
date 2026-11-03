import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { typeText } from "../../../../../TestUtils/domQueries.ts";
import { drawSelections } from "../../../../../TestUtils/snippetPane.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import { SnippetController2 } from "../../../../editor/contrib/snippet/browser/snippetController2.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import { WorkbenchContextKeysDIToken } from "../../../browser/workbenchContextKeys.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import type { TextFileModel } from "../../../services/textfile/common/textFileModel.ts";
import { CompletionServiceDIToken } from "../../suggest/browser/completionService.ts";
import { SuggestComponentDIToken } from "../../suggest/browser/suggestComponent.ts";

/** A choice of a snippet session in the whole workbench: its popup, the keys on it, its exclusive provider. */
describe("Snippet session — a choice", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let pane: TextEditorPane<TextFileModel>;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-snippet-choice-" });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(80, 20) });
        h.workbench.openFile(ws.writeFile("doc.txt", ""));
        h.workbench.focusEditor();
        pane = h.container.get(EditorServiceDIToken).getActiveEditor() as TextEditorPane<TextFileModel>;
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    /** The popup opens a microtask after the selection change, its provider answers a promise later. */
    function settle(): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, 10));
    }

    async function insert(template: string): Promise<void> {
        const { document } = pane.viewState;
        const line = document.lineCount - 1;
        const end = { line, character: document.getLineContent(line).length };
        SnippetController2.get(pane).apply([{ range: { start: end, end }, template }], {});
        await settle();
    }

    /** The labels on the popup, top to bottom; `null` with it closed. */
    function popup(): readonly string[] | null {
        const completion = h.container.get(CompletionServiceDIToken);
        if (!completion.isOpen()) return null;
        return h.container.get(SuggestComponentDIToken).view.items.map((item) => item.label);
    }

    function inSnippetChoice(): unknown {
        h.container.get(WorkbenchContextKeysDIToken).update();
        return h.container.get(ContextKeyServiceDIToken).get("inSnippetChoice");
    }

    /** The rows of the frame from the editor's first line down. */
    function editorRows(): string[] {
        h.testApp.render();
        const rows = h.testApp.backend.screenToString().split("\n");
        return rows.slice(rows.findIndex((row) => row.includes(" 1   ")));
    }

    it("reaching a choice opens the popup with its options in order, drawn at the caret", async () => {
        await insert("${1|get,set|} $2");
        expect(drawSelections(pane)).toBe("[get] ");
        expect(popup()).toEqual(["get", "set"]);
        expect(inSnippetChoice()).toBe(true);
        const [line, first, second] = editorRows();
        expect(line).toMatch(/ 1 {3}get ?╭─+╮/);
        expect(first).toMatch(/│.*get.*│/);
        expect(second).toMatch(/│.*set.*│/);
    });

    it("the options keep the author's order, not the alphabet's", async () => {
        await insert("${1|zeta,alpha,mid|}");
        expect(popup()).toEqual(["zeta", "alpha", "mid"]);
    });

    it("Down and Enter put the option in and go on to the next tab stop", async () => {
        await insert("${1|get,set|} $2");
        h.testApp.sendKey("ArrowDown");
        h.testApp.sendKey("Enter");
        await settle();
        expect(drawSelections(pane)).toBe("set |");
        expect(popup()).toBeNull();
        expect(inSnippetChoice()).toBe(false);
    });

    it("Tab accepts the selected option as Enter does", async () => {
        await insert("${1|get,set|} ${2:x}");
        h.testApp.sendKey("Tab");
        await settle();
        expect(drawSelections(pane)).toBe("get [x]");
    });

    it("Escape closes the popup and keeps the session; Tab then goes on with the text as it is", async () => {
        await insert("${1|get,set|} ${2:x}");
        h.testApp.sendKey("Escape");
        expect(popup()).toBeNull();
        expect(SnippetController2.get(pane).isInSnippet).toBe(true);
        expect(inSnippetChoice()).toBe(true);
        h.testApp.sendKey("Tab");
        expect(drawSelections(pane)).toBe("get [x]");
    });

    it("typing other text filters the options as plain suggestions", async () => {
        await insert("${1|get,set|} $2");
        typeText(h.testApp, "s");
        expect(popup()).toEqual(["set"]);
        h.testApp.sendKey("Enter");
        await settle();
        expect(drawSelections(pane)).toBe("set |");
    });

    it("back on a choice whose text is no option, the options are filtered by it", async () => {
        await insert("${1|get,set|} ${2:x}");
        h.testApp.sendKey("Escape");
        typeText(h.testApp, "s");
        h.testApp.sendKey("Tab");
        h.testApp.sendKey("Shift+Tab");
        await settle();
        expect(drawSelections(pane)).toBe("[s] x");
        expect(popup()).toEqual(["set"]);
    });

    it("a choice left before the popup came up opens none", async () => {
        const { document } = pane.viewState;
        SnippetController2.get(pane).apply(
            [
                {
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                    template: "${1|a,b|} ${2:x}",
                },
            ],
            {},
        );
        expect(document.getText()).toBe("a x");
        SnippetController2.get(pane).next();
        await settle();
        expect(popup()).toBeNull();
    });

    it("the choice's provider answers only at the primary caret on the choice", async () => {
        await insert("${1|get,set|} ${2:x}");
        const [choiceProvider] = h.container.get(LanguageFeaturesServiceDIToken).completionProvider.ordered(pane);
        const request = { uri: pane.uri.toString(), languageId: pane.languageId, versionId: 0 };
        const ask = async (line: number, character: number) =>
            (await choiceProvider.provideCompletionItems({ ...request, line, character }, CancellationTokenNone)).items;
        expect((await ask(0, 3)).map((item) => item.label)).toEqual(["get", "set"]);
        expect(await ask(0, 2)).toEqual([]);
        h.testApp.sendKey("Escape");
        h.testApp.sendKey("Tab");
        expect(await ask(0, 5)).toEqual([]);
    });

    it("Shift+Tab with the popup open goes back to the previous tab stop and closes it", async () => {
        await insert("${1:a} ${2|x,y|}");
        h.testApp.sendKey("Tab");
        await settle();
        expect(popup()).toEqual(["x", "y"]);
        h.testApp.sendKey("Shift+Tab");
        await settle();
        expect(drawSelections(pane)).toBe("[a] x");
        expect(popup()).toBeNull();
        expect(inSnippetChoice()).toBe(false);
    });

    it("the next choice brings its own options", async () => {
        await insert("${1|a,b|} ${2|x,y|}");
        h.testApp.sendKey("Enter");
        await settle();
        expect(drawSelections(pane)).toBe("a [x]");
        expect(popup()).toEqual(["x", "y"]);
    });

    it("a click on another tab stop closes the popup and keeps the session", async () => {
        await insert("${1|get,set|} ${2:x}");
        pane.viewState.selections = [createCursorSelection(0, 5)];
        expect(popup()).toBeNull();
        expect(SnippetController2.get(pane).isInSnippet).toBe(true);
        expect(inSnippetChoice()).toBe(false);
    });

    it("a click away closes the popup and the session", async () => {
        await insert("${1|get,set|} ${2:x} end");
        pane.viewState.selections = [createCursorSelection(0, 8)];
        expect(popup()).toBeNull();
        expect(SnippetController2.get(pane).isInSnippet).toBe(false);
        expect(inSnippetChoice()).toBe(false);
    });

    it("the language's providers are not asked on a choice, and are again once the session leaves it", async () => {
        const languageFeatures = h.container.get(LanguageFeaturesServiceDIToken);
        const asked: number[] = [];
        languageFeatures.completionProvider.register("*", {
            triggerCharacters: [],
            provideCompletionItems: (request) => {
                asked.push(request.character);
                return Promise.resolve({ items: [{ label: "other", insertText: "other" }], isIncomplete: false });
            },
        });
        await insert("${1|get,set|} $2");
        pane.viewState.selections = [createCursorSelection(0, 3)];
        await h.container.get(CompletionServiceDIToken).trigger();
        expect(popup()).toEqual(["get", "set"]);
        expect(asked).toEqual([]);
        h.testApp.sendKey("Escape");
        h.testApp.sendKey("Tab");
        await h.container.get(CompletionServiceDIToken).trigger();
        expect(asked).toEqual([4]);
        expect(popup()).toEqual(["other"]);
    });

    it("a choice with mirrors opens the popup at the primary caret, the option goes into every mirror", async () => {
        await insert("${1|a,b|} = $1;$0");
        expect(drawSelections(pane)).toBe("[a] = [a];");
        expect(popup()).toEqual(["a", "b"]);
        h.testApp.sendKey("ArrowDown");
        h.testApp.sendKey("Enter");
        await settle();
        expect(drawSelections(pane)).toBe("b = b;|");
    });
});
