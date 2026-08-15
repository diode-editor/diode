import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EditorTabStripElement } from "@tuidom/elements/editorgroup/editorTabStripElement";
import type { QuickPickElement } from "@tuidom/elements/quickpick/quickPickElement";
import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../TestUtils/timing.ts";
import type { EditorService } from "../services/editor/browser/editorService.ts";

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

        // The wired workbench.openFile callback opens an editor tab.
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

        // Enter command mode via the registered Show Commands command.
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

    function activeEditor(): EditorService {
        return (h.workbench as unknown as { editorService: EditorService }).editorService;
    }

    beforeEach(async () => {
        ws = createTempWorkspace({
            prefix: "diode-gotoline-",
            files: {
                // A 60-line file to navigate around.
                "big.txt": Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join("\n"),
            },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir });
        await h.workbench.activate();
        await h.workbench.fileIndexReady;
        // Open the file so there is an active editor to navigate.
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
        // Close the current editor state by opening via quick open with a suffix.
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
