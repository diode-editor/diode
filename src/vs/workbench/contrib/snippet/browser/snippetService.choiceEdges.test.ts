import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { typeText } from "../../../../../TestUtils/domQueries.ts";
import { drawSelections } from "../../../../../TestUtils/snippetPane.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";
import { SnippetController2 } from "../../../../editor/contrib/snippet/browser/snippetController2.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import { WorkbenchContextKeysDIToken } from "../../../browser/workbenchContextKeys.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import type { TextFileModel } from "../../../services/textfile/common/textFileModel.ts";
import { CompletionServiceDIToken } from "../../suggest/browser/completionService.ts";
import { SuggestComponentDIToken } from "../../suggest/browser/suggestComponent.ts";

/** Edges of a snippet choice in the whole workbench, as a user meets them. */
describe("Snippet session — a choice, edges", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let pane: TextEditorPane<TextFileModel>;

    function open(text: string): void {
        h.workbench.openFile(ws.writeFile("doc.txt", text));
        h.workbench.focusEditor();
        pane = h.container.get(EditorServiceDIToken).getActiveEditor() as TextEditorPane<TextFileModel>;
    }

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-snippet-choice-edges-" });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(80, 20) });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

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

    function popup(): readonly string[] | null {
        const completion = h.container.get(CompletionServiceDIToken);
        if (!completion.isOpen()) return null;
        return h.container.get(SuggestComponentDIToken).view.items.map((item) => item.label);
    }

    function inSnippetChoice(): unknown {
        h.container.get(WorkbenchContextKeysDIToken).update();
        return h.container.get(ContextKeyServiceDIToken).get("inSnippetChoice");
    }

    it("a choice as the last tab stop: Enter puts the option in and ends the session", async () => {
        open("");
        await insert("x ${1|a,b|}");
        expect(popup()).toEqual(["a", "b"]);
        h.testApp.sendKey("ArrowDown");
        h.testApp.sendKey("Enter");
        await settle();
        expect(drawSelections(pane)).toBe("x b|");
        expect(popup()).toBeNull();
        expect(SnippetController2.get(pane).isInSnippet).toBe(false);
        expect(inSnippetChoice()).toBe(false);
    });

    it("options keep escaped commas and unicode as authored", async () => {
        open("");
        await insert("${1|a\\,b,ж,😀|} $2");
        expect(popup()).toEqual(["a,b", "ж", "😀"]);
        h.testApp.sendKey("ArrowDown");
        h.testApp.sendKey("ArrowDown");
        h.testApp.sendKey("Enter");
        await settle();
        expect(drawSelections(pane)).toBe("😀 |");
    });

    it("many options are all in the popup", async () => {
        open("");
        const options = Array.from({ length: 30 }, (_, i) => `o${i}`);
        await insert(`\${1|${options.join(",")}|} $2`);
        expect(popup()).toEqual(options);
    });

    it("Shift+Tab back onto a choice opens its popup again", async () => {
        open("");
        await insert("${1|a,b|} ${2:x}");
        h.testApp.sendKey("Escape");
        h.testApp.sendKey("Tab");
        await settle();
        expect(popup()).toBeNull();
        h.testApp.sendKey("Shift+Tab");
        await settle();
        expect(drawSelections(pane)).toBe("[a] x");
        expect(popup()).toEqual(["a", "b"]);
        expect(inSnippetChoice()).toBe(true);
    });

    it("a second Escape ends the session, the key goes false", async () => {
        open("");
        await insert("${1|a,b|} ${2:x}");
        h.testApp.sendKey("Escape");
        h.testApp.sendKey("Escape");
        expect(popup()).toBeNull();
        expect(SnippetController2.get(pane).isInSnippet).toBe(false);
        expect(inSnippetChoice()).toBe(false);
    });

    it("undo after picking an option brings the first option back", async () => {
        open("");
        await insert("${1|a,b|} $2");
        h.testApp.sendKey("ArrowDown");
        h.testApp.sendKey("Enter");
        await settle();
        expect(pane.viewState.document.getText()).toBe("b ");
        h.testApp.sendKey("Ctrl+Z");
        await settle();
        expect(pane.viewState.document.getText()).toBe("a ");
    });

    it("undo of the whole insertion with the popup open closes the popup", async () => {
        open("");
        await insert("${1|a,b|} $2");
        expect(popup()).toEqual(["a", "b"]);
        h.testApp.sendKey("Ctrl+Z");
        await settle();
        expect(pane.viewState.document.getText()).toBe("");
        expect(popup()).toBeNull();
        expect(inSnippetChoice()).toBe(false);
    });

    it("the buffer's words are not mixed into the choice popup", async () => {
        open("gamma getter settle\n");
        await insert("${1|get,set|} $2");
        expect(popup()).toEqual(["get", "set"]);
        await h.container.get(CompletionServiceDIToken).trigger();
        expect(popup()).toEqual(["get", "set"]);
    });

    it("a choice picked into a transformed mirror is transformed on the way on", async () => {
        open("");
        await insert("${1|_a,_b|} ${1/^_(.*)/$1/} $2");
        h.testApp.sendKey("ArrowDown");
        h.testApp.sendKey("Enter");
        await settle();
        expect(drawSelections(pane)).toBe("_b b |");
    });

    it("a snippet at two carets: the option goes into both", async () => {
        open("one\ntwo");
        const at = (line: number) => ({ start: { line, character: 3 }, end: { line, character: 3 } });
        SnippetController2.get(pane).apply(
            [
                { range: at(0), template: " ${1|a,b|}$0" },
                { range: at(1), template: " ${1|a,b|}$0" },
            ],
            {},
        );
        await settle();
        expect(popup()).toEqual(["a", "b"]);
        h.testApp.sendKey("ArrowDown");
        h.testApp.sendKey("Enter");
        await settle();
        expect(pane.viewState.document.getText()).toBe("one b\ntwo b");
    });

    it("typing the whole text of the other option leaves it the selected one, Enter keeps it", async () => {
        open("");
        await insert("${1|get,set|} $2");
        typeText(h.testApp, "set");
        expect(popup()).not.toBeNull();
        h.testApp.sendKey("Enter");
        await settle();
        expect(drawSelections(pane)).toBe("set |");
    });

    it("Backspace to an empty choice keeps the session on it", async () => {
        open("");
        await insert("${1|get,set|} $2");
        h.testApp.sendKey("Backspace");
        await settle();
        expect(drawSelections(pane)).toBe("| ");
        expect(inSnippetChoice()).toBe(true);
    });

    it("moving the caret out of the choice with an arrow closes the popup", async () => {
        open("");
        await insert("${1|get,set|} tail $2");
        h.testApp.sendKey("Escape");
        pane.viewState.selections = [createCursorSelection(0, 1)];
        await settle();
        expect(inSnippetChoice()).toBe(true);
        pane.viewState.selections = [createCursorSelection(0, 6)];
        await settle();
        expect(popup()).toBeNull();
        expect(inSnippetChoice()).toBe(false);
    });
});
