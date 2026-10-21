import type { EditorTabStripElement } from "@tuidom/elements/editorgroup/editorTabStripElement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../TestUtils/timing.ts";
import type { IEditorService } from "../services/editor/common/editorService.ts";

import type { QuickPickElement } from "./parts/quickinput/quickPickElement.ts";

describe("Workbench — Quick Open accept callbacks", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(async () => {
        ws = createTempWorkspace({
            prefix: "diode-quickopen-",
            files: {
                "alpha.txt": "Alpha content",
                "beta.txt": "Beta content",
            },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir });
        await h.workbench.activate();
        // The file index now builds in the background — wait for it so the picker
        // has entries when the test opens Quick Open.
        await h.workbench.fileIndexReady;
        h.testApp.render();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
        vi.restoreAllMocks();
    });

    it("accepting a file entry opens it in the editor (workbench.openFile)", async () => {
        const executeSpy = vi.spyOn(h.commands, "execute");
        h.workbench.focusEditor();
        h.testApp.sendKey("Ctrl+P");
        h.testApp.render();

        const picker = h.testApp.querySelector("QuickPickElement") as QuickPickElement;
        const alpha = picker.items.find((i) => i.label === "alpha.txt")!;
        expect(alpha).toBeDefined();

        picker.onAccept?.(alpha, picker.items.indexOf(alpha));
        await flushMicrotasks(2);
        h.testApp.render();

        const alphaPath = ws.path("alpha.txt");
        expect(executeSpy).toHaveBeenCalledWith("workbench.openFile", alphaPath);

        const tabStrip = h.testApp.querySelector("EditorTabStripElement") as EditorTabStripElement;
        expect(tabStrip.getItemElements().length).toBeGreaterThan(0);
    });

    it("workbench.openFile command opens an editor and updates the status bar", () => {
        const alphaPath = ws.path("alpha.txt");

        h.commands.execute("workbench.openFile", alphaPath);
        h.testApp.render();

        const tabStrip = h.testApp.querySelector("EditorTabStripElement") as EditorTabStripElement;
        const labels = tabStrip.getItemElements().map((el) => el.getLabel());
        expect(labels.some((l) => l.includes("alpha.txt"))).toBe(true);
    });

    it("command-mode accept executes the chosen command (onExecuteCommand)", async () => {
        const ran = vi.fn();
        h.commands.register("test.quickOpenTarget", ran, "Quick Open Target Command");
        h.workbench.focusEditor();

        h.commands.execute("workbench.action.showCommands");
        h.testApp.render();

        const picker = h.testApp.querySelector("QuickPickElement") as QuickPickElement;
        const target = picker.items.find((i) => i.label === "Quick Open Target Command")!;
        expect(target).toBeDefined();

        picker.onAccept?.(target, picker.items.indexOf(target));
        await flushMicrotasks(2);

        expect(ran).toHaveBeenCalledTimes(1);
    });

    it("accepting closes the quick-open overlay", async () => {
        h.workbench.focusEditor();
        h.testApp.sendKey("Ctrl+P");
        h.testApp.render();
        expect(h.testApp.root.overlayLayer.hasVisibleItems()).toBe(true);

        const picker = h.testApp.querySelector("QuickPickElement") as QuickPickElement;
        const first = picker.items[0];
        expect(first).toBeDefined();

        picker.onAccept?.(first, 0);
        await flushMicrotasks(2);
        h.testApp.render();

        expect(h.testApp.root.overlayLayer.hasVisibleItems()).toBe(false);
    });
});

describe("Workbench — Go to Line", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    function activeEditor(): IEditorService {
        return (h.workbench as unknown as { editorService: IEditorService }).editorService;
    }

    beforeEach(async () => {
        ws = createTempWorkspace({
            prefix: "diode-gotoline-",
            files: {
                "big.txt": Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join("\n"),
            },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir });
        await h.workbench.activate();
        await h.workbench.fileIndexReady;
        h.commands.execute("workbench.openFile", ws.path("big.txt"));
        h.testApp.render();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
        vi.restoreAllMocks();
    });

    it("Ctrl+G opens Quick Open seeded with ':'", () => {
        h.workbench.focusEditor();
        h.testApp.sendKey("Ctrl+G");
        h.testApp.render();

        expect(h.testApp.root.overlayLayer.hasVisibleItems()).toBe(true);
        const picker = h.testApp.querySelector("QuickPickElement") as QuickPickElement;
        expect(picker.getQuery()).toBe(":");
    });

    it("accepting ':30' moves the cursor to that line (1-based → 0-based)", async () => {
        h.workbench.focusEditor();
        h.commands.execute("workbench.action.gotoLine");
        h.testApp.render();

        const picker = h.testApp.querySelector("QuickPickElement") as QuickPickElement;
        picker.onQueryChange?.(":30");
        h.testApp.render();

        picker.onAccept?.(picker.items[0], 0);
        await flushMicrotasks(2);
        h.testApp.render();

        expect(activeEditor().getActiveEditor()?.primaryCursorLine).toBe(29);
        expect(h.testApp.root.overlayLayer.hasVisibleItems()).toBe(false);
    });

    it("accepting ':30:5' moves both the line and the column", async () => {
        h.workbench.focusEditor();
        h.commands.execute("workbench.action.gotoLine");
        h.testApp.render();

        const picker = h.testApp.querySelector("QuickPickElement") as QuickPickElement;
        picker.onQueryChange?.(":30:5");
        h.testApp.render();

        picker.onAccept?.(picker.items[0], 0);
        await flushMicrotasks(2);
        h.testApp.render();

        const editor = activeEditor().getActiveEditor()!;
        expect(editor.primaryCursorLine).toBe(29);
        expect(editor.primaryCursorColumn).toBe(4);
    });

    it("a file:line query opens the file and jumps to the line", async () => {
        h.workbench.focusEditor();
        h.testApp.sendKey("Ctrl+P");
        h.testApp.render();

        const picker = h.testApp.querySelector("QuickPickElement") as QuickPickElement;
        picker.onQueryChange?.("big:15");
        h.testApp.render();

        const target = picker.items.find((i) => i.label === "big.txt")!;
        expect(target).toBeDefined();
        picker.onAccept?.(target, picker.items.indexOf(target));
        await flushMicrotasks(2);
        h.testApp.render();

        expect(activeEditor().getActiveEditor()?.primaryCursorLine).toBe(14);
    });
});

/**
 * Only a test like this sees the wiring (DI seams, the QUICK_ACCESS_PROVIDERS entry, the action
 * with its binding): the provider's unit tests work with their own fakes.
 */
describe("Workbench: open editors picker (Ctrl+K Ctrl+P)", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    function editorService(): IEditorService {
        return (h.workbench as unknown as { editorService: IEditorService }).editorService;
    }

    function picker(): QuickPickElement {
        return h.testApp.querySelector("QuickPickElement") as QuickPickElement;
    }

    beforeEach(async () => {
        ws = createTempWorkspace({
            prefix: "diode-open-editors-",
            files: {
                "alpha.txt": "Alpha content",
                "nested/beta.txt": "Beta content",
            },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir });
        await h.workbench.activate();
        await h.workbench.fileIndexReady;
        h.commands.execute("workbench.openFile", ws.path("alpha.txt"));
        h.commands.execute("workbench.openFile", ws.path("nested/beta.txt"));
        h.testApp.render();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
        vi.restoreAllMocks();
    });

    it("the Ctrl+K Ctrl+P chord opens the picker with open tabs in MRU order", () => {
        h.workbench.focusEditor();
        h.testApp.sendKey("Ctrl+K");
        h.testApp.sendKey("Ctrl+P");
        h.testApp.render();

        expect(picker().getQuery()).toBe("edt ");
        expect(picker().items.map((item) => item.label)).toEqual(["beta.txt", "alpha.txt"]);
        expect(picker().items.map((item) => item.description)).toEqual(["nested", ""]);
    });

    it("the command is in the command palette with its title and keybinding", () => {
        h.workbench.focusEditor();
        h.commands.execute("workbench.action.showCommands");
        h.testApp.render();

        const entry = picker().items.find((item) => item.label === "Show All Editors");
        expect(entry).toBeDefined();
        expect(entry?.shortcut).toBe("Ctrl+K Ctrl+P");
    });

    it("accepting a row switches to its tab", async () => {
        h.workbench.focusEditor();
        h.commands.execute("workbench.action.showAllEditors");
        h.testApp.render();

        const target = picker().items.find((item) => item.label === "alpha.txt")!;
        picker().onAccept?.(target, picker().items.indexOf(target));
        await flushMicrotasks(2);
        h.testApp.render();

        expect(editorService().getActiveEditor()?.fileName).toBe("alpha.txt");
        expect(h.testApp.root.overlayLayer.hasVisibleItems()).toBe(false);
    });

    it("an unsaved tab is marked with a dot in the list", () => {
        h.workbench.focusEditor();
        h.commands.execute("workbench.action.showAllEditors");
        h.testApp.render();
        expect(picker().items[0].hint).toBeUndefined();
        h.testApp.sendKey("Escape");

        h.workbench.focusEditor();
        h.testApp.sendKey("x");
        h.commands.execute("workbench.action.showAllEditors");
        h.testApp.render();

        expect(picker().items[0].hint).toBe("●");
    });
});
