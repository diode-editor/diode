import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Size } from "@tuidom/core/common/geometryPromitives";
import type { TreeViewElement } from "@tuidom/elements/tree/treeViewElement";
import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import type { EditorElement } from "../../editor/browser/editorElement.ts";

// Shift+F10 opens the context menu on whichever component is focused — the same menu
// that a right-click produces. `when` (textInputFocus / listFocus) routes the shared
// binding to the editor or the explorer without collision.
describe("Workbench — Shift+F10 context menu", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(async () => {
        ws = createTempWorkspace({
            prefix: "vexx-ctxmenu-",
            files: { "alpha.txt": "hello world", "beta.txt": "x" },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(80, 40) });
        await h.workbench.activate();
        h.testApp.render();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("opens the explorer context menu when the file tree is focused", () => {
        (h.testApp.querySelector("TreeViewElement") as TreeViewElement<unknown>).focus();
        h.testApp.render();

        h.testApp.sendKey("Shift+F10");
        h.testApp.render();

        expect(h.testApp.querySelector("PopupMenuElement")).not.toBeNull();
        // Explorer-specific entry — proves it is the file-tree menu, not the editor's.
        expect(h.testApp.backend.screenToString()).toContain("New File");
    });

    it("opens the editor context menu when the editor is focused", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.workbench.focusEditor();
        h.testApp.render();
        expect(h.testApp.focusedElement?.constructor.name).toBe("EditorElement");

        h.testApp.sendKey("Shift+F10");
        h.testApp.render();

        expect(h.testApp.querySelector("PopupMenuElement")).not.toBeNull();
        // Editor menu carries clipboard entries.
        expect(h.testApp.backend.screenToString()).toContain("Copy");
    });

    it("anchors the editor menu at the caret", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.workbench.focusEditor();
        h.testApp.render();
        const editor = h.testApp.querySelector("EditorElement") as EditorElement;
        const caret = editor.getCaretScreenCell();
        expect(caret).not.toBeNull();

        h.testApp.sendKey("Shift+F10");
        h.testApp.render();

        const menu = h.testApp.querySelectorAll("PopupMenuElement");
        expect(menu).toHaveLength(1);
        expect(menu[0].globalPosition.x).toBe(caret!.x);
        // Канон openPopupSession: попап открывается строкой ниже якоря
        // (preferBelow), у нижнего края экрана флипается вверх.
        expect(menu[0].globalPosition.y).toBe(caret!.y + 1);
    });

    it("Escape closes the menu opened via Shift+F10", () => {
        (h.testApp.querySelector("TreeViewElement") as TreeViewElement<unknown>).focus();
        h.testApp.render();
        h.testApp.sendKey("Shift+F10");
        h.testApp.render();
        expect(h.testApp.querySelector("PopupMenuElement")).not.toBeNull();

        h.testApp.sendKey("Escape");
        h.testApp.render();

        expect(h.testApp.querySelector("PopupMenuElement")).toBeNull();
    });
});
