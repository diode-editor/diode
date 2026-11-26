import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { typeText } from "../../../../../TestUtils/domQueries.ts";
import { drawSelections } from "../../../../../TestUtils/snippetPane.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";
import { SnippetController2 } from "../../../../editor/contrib/snippet/browser/snippetController2.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import type { TextFileModel } from "../../../services/textfile/common/textFileModel.ts";

/** The keys of a snippet session in the whole workbench: bindings, weights and the context keys behind them. */
describe("Snippet session — the keyboard", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-snippet-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    function open(content: string): { h: IAppHarness; pane: TextEditorPane<TextFileModel> } {
        const h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(80, 20) });
        h.workbench.openFile(ws.writeFile("doc.txt", content));
        h.workbench.focusEditor();
        const pane = h.container.get(EditorServiceDIToken).getActiveEditor() as TextEditorPane<TextFileModel>;
        return { h, pane };
    }

    function insert(pane: TextEditorPane<TextFileModel>, line: number, character: number, template: string): void {
        const position = { line, character };
        SnippetController2.get(pane).apply([{ range: { start: position, end: position }, template }], {});
    }

    it("Tab goes through the tab stops, typing fills the mirrors, the Tab after `$0` indents again", () => {
        const { h, pane } = open("");
        insert(pane, 0, 0, "${1:name} = $1;$0");
        typeText(h.testApp, "a");
        expect(drawSelections(pane)).toBe("a| = a|;");
        h.testApp.sendKey("Tab");
        expect(drawSelections(pane)).toBe("a = a;|");
        h.testApp.sendKey("Tab");
        expect(drawSelections(pane)).toBe("a = a;  |");
    });

    it("Shift+Tab goes back; on the first tab stop it outdents as without a session", () => {
        const { h, pane } = open("    ");
        insert(pane, 0, 4, "${1:a} ${2:b}");
        h.testApp.sendKey("Tab");
        expect(drawSelections(pane)).toBe("    a [b]");
        h.testApp.sendKey("Shift+Tab");
        expect(drawSelections(pane)).toBe("    [a] b");
        h.testApp.sendKey("Shift+Tab");
        expect(pane.viewState.document.getText()).toBe("a b");
    });

    it("Escape leaves the session with one caret; the next Tab indents", () => {
        const { h, pane } = open("");
        insert(pane, 0, 0, "${1:x} = $1");
        h.testApp.sendKey("Escape");
        expect(drawSelections(pane)).toBe("[x] = x");
        expect(SnippetController2.get(pane).isInSnippet).toBe(false);
        pane.viewState.selections = [createCursorSelection(0, 0)];
        h.testApp.sendKey("Tab");
        expect(pane.viewState.document.getText()).toBe("    x = x");
    });
});
