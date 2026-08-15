import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Size } from "@tuidom/core/common/geometryPromitives";
import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import type { EditorElement } from "../../editor/browser/editorElement.ts";
import { createCursorSelection, createSelection } from "../../editor/common/core/iSelection.ts";

function createIntegrationApp(ws: ITempWorkspace): IAppHarness {
    return createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(80, 40) });
}

function openFocusedEditor(h: IAppHarness, ws: ITempWorkspace, content: string): EditorElement {
    const file = ws.writeFile("doc.txt", content);
    h.workbench.openFile(file);
    h.workbench.focusEditor();
    const editor = h.testApp.querySelector("EditorElement") as EditorElement;
    expect(editor).not.toBeNull();
    return editor;
}

describe("Workbench — Tab / Shift+Tab indentation", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        // A couple of sibling files so the workbench has a focusable tree to cycle to.
        ws = createTempWorkspace({
            prefix: "diode-indent-",
            files: {
                "sibling-0.txt": "x",
                "sibling-1.txt": "x",
                "sibling-2.txt": "x",
            },
        });
    });

    afterEach(() => {
        ws.dispose();
    });

    it("Tab indents the focused editor", () => {
        const h = createIntegrationApp(ws);
        const editor = openFocusedEditor(h, ws, "hello");
        editor.viewState.selections = [createCursorSelection(0, 0)];

        h.testApp.sendKey("Tab");

        expect(editor.viewState.document.getText()).toBe("\thello");
    });

    it("Tab keeps focus on the editor instead of cycling", () => {
        const h = createIntegrationApp(ws);
        const editor = openFocusedEditor(h, ws, "hello");

        h.testApp.sendKey("Tab");

        expect(h.testApp.focusedElement).toBe(editor);
    });

    it("Tab indents every line of a multi-line selection", () => {
        const h = createIntegrationApp(ws);
        const editor = openFocusedEditor(h, ws, "aa\nbb");
        editor.viewState.selections = [createSelection(0, 0, 1, 2)];

        h.testApp.sendKey("Tab");

        expect(editor.viewState.document.getText()).toBe("\taa\n\tbb");
    });

    it("Shift+Tab outdents the focused editor", () => {
        const h = createIntegrationApp(ws);
        const editor = openFocusedEditor(h, ws, "\thello");
        editor.viewState.selections = [createCursorSelection(0, 3)];

        h.testApp.sendKey("Shift+Tab");

        expect(editor.viewState.document.getText()).toBe("hello");
    });

    it("Shift+Tab keeps focus on the editor instead of cycling", () => {
        const h = createIntegrationApp(ws);
        const editor = openFocusedEditor(h, ws, "\thello");

        h.testApp.sendKey("Shift+Tab");

        expect(h.testApp.focusedElement).toBe(editor);
    });
});
