import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import type { EditorService } from "../services/editor/browser/editorService.ts";

import type { WorkbenchComponent } from "./workbenchComponent.ts";

function createIntegrationWorkspace(): ITempWorkspace {
    return createTempWorkspace({
        prefix: "diode-integration-",
        files: {
            "hello.txt": "hello world",
            "notes.md": "# Notes",
        },
    });
}

describe("FileTree opens file in editor", () => {
    let ws: ITempWorkspace;
    let testApp: IAppHarness["testApp"];
    let workbench: WorkbenchComponent;

    beforeEach(async () => {
        ws = createIntegrationWorkspace();
        const h = createAppTestHarness({ workspaceFolder: ws.dir });
        testApp = h.testApp;
        workbench = h.workbench;
        await workbench.activate();
        testApp.render();
    });

    afterEach(() => {
        workbench.dispose();
        ws.dispose();
    });

    it("activating a file in the tree opens it in the editor", () => {
        const tree = testApp.querySelector("TreeViewElement");
        expect(tree).not.toBeNull();

        // Focus tree and navigate to a file, then press Enter
        tree!.focus();
        testApp.render();

        // First item is "hello.txt" (files sorted alphabetically; no directories here)
        testApp.sendKey("Enter");
        testApp.render();

        // File should now be open in the editor group
        const editorGroupCtrl = (workbench as unknown as { editorService: EditorService }).editorService;
        expect(editorGroupCtrl.editorCount).toBe(1);
        expect(editorGroupCtrl.getActiveEditor()?.fileName).toBe("hello.txt");
    });

    it("activating a second file opens another tab", () => {
        const tree = testApp.querySelector("TreeViewElement");
        tree!.focus();
        testApp.render();

        // Activate first file — focus moves to editor
        testApp.sendKey("Enter");
        testApp.render();

        // Return focus to tree to navigate to second file
        tree!.focus();
        testApp.sendKey("ArrowDown");
        testApp.sendKey("Enter");
        testApp.render();

        const editorGroupCtrl = (workbench as unknown as { editorService: EditorService }).editorService;
        expect(editorGroupCtrl.editorCount).toBe(2);
    });

    it("focus moves to editor after activating a file from the tree", () => {
        const tree = testApp.querySelector("TreeViewElement");
        tree!.focus();
        testApp.render();

        testApp.sendKey("Enter");
        testApp.render();

        const focused = testApp.focusedElement;
        expect(focused).not.toBeNull();
        expect(focused!.constructor.name).toBe("EditorElement");
    });

    it("does not call console.log when activating file", () => {
        const consoleSpy = vi.spyOn(console, "log");

        const tree = testApp.querySelector("TreeViewElement");
        tree!.focus();
        testApp.render();

        testApp.sendKey("Enter");

        expect(consoleSpy).not.toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    it("does not insert characters into editor when opened with Enter", () => {
        const tree = testApp.querySelector("TreeViewElement");
        tree!.focus();
        testApp.render();

        testApp.sendKey("Enter");
        testApp.render();

        const editorGroupCtrl = (workbench as unknown as { editorService: EditorService }).editorService;
        expect(editorGroupCtrl.getActiveEditor()?.getText()).toBe("hello world");
    });
});

describe("sidebar visibility commands", () => {
    let ws: ITempWorkspace;
    let testApp: IAppHarness["testApp"];
    let workbench: WorkbenchComponent;
    let commands: IAppHarness["commands"];

    beforeEach(async () => {
        ws = createIntegrationWorkspace();
        const h = createAppTestHarness({ workspaceFolder: ws.dir });
        testApp = h.testApp;
        workbench = h.workbench;
        commands = h.commands;
        await workbench.activate();
        testApp.render();
    });

    afterEach(() => {
        workbench.dispose();
        ws.dispose();
    });

    it("Ctrl+B hides the left panel", () => {
        expect(workbench.workbenchLayout.getLeftPanelVisible()).toBe(true);
        testApp.sendKey("Ctrl+B");
        testApp.render();
        expect(workbench.workbenchLayout.getLeftPanelVisible()).toBe(false);
    });

    it("Ctrl+B toggles back to visible", () => {
        testApp.sendKey("Ctrl+B");
        testApp.render();
        expect(workbench.workbenchLayout.getLeftPanelVisible()).toBe(false);

        testApp.sendKey("Ctrl+B");
        testApp.render();
        expect(workbench.workbenchLayout.getLeftPanelVisible()).toBe(true);
    });

    it("Ctrl+Shift+E makes hidden panel visible", () => {
        workbench.workbenchLayout.setLeftPanelVisible(false);
        workbench.workbenchLayout.markDirty();
        testApp.render();

        commands.execute("workbench.view.explorer");
        testApp.render();

        expect(workbench.workbenchLayout.getLeftPanelVisible()).toBe(true);
    });

    it("Ctrl+Shift+E focuses the file tree", async () => {
        await workbench.activate();
        testApp.render();

        commands.execute("workbench.view.explorer");
        testApp.render();

        const focused = testApp.focusedElement;
        expect(focused).not.toBeNull();
        expect(focused!.constructor.name).toBe("TreeViewElement");
    });
});
