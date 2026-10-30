import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../TestUtils/timing.ts";
import type { IEditorService } from "../services/editor/common/editorService.ts";

import type { QuickPickElement } from "./parts/quickinput/quickPickElement.ts";

describe("Workbench: Quick Open lists recently opened files", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    function picker(): QuickPickElement {
        return h.testApp.querySelector("QuickPickElement") as QuickPickElement;
    }

    function activeFile(): string | undefined {
        const editors = (h.workbench as unknown as { editorService: IEditorService }).editorService;
        return editors.getActiveEditor()?.uri.fsPath;
    }

    beforeEach(async () => {
        ws = createTempWorkspace({
            prefix: "diode-quickopen-history-",
            files: { "a.ts": "a", "b.ts": "b", "src/c.ts": "c", "unrelated.md": "x" },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir });
        await h.workbench.activate();
        await h.workbench.fileIndexReady;
        for (const name of ["a.ts", "b.ts", "src/c.ts"]) h.commands.execute("workbench.openFile", ws.path(name));
        h.testApp.render();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
        vi.restoreAllMocks();
    });

    it("Ctrl+P with an empty query shows the history, a closed tab included, and no other files", async () => {
        // Closing c.ts activates b.ts: it goes on top, the closed c.ts stays next.
        await h.commands.execute("workbench.action.closeActiveEditor");
        h.testApp.render();
        expect(activeFile()).toBe(ws.path("b.ts"));
        h.workbench.focusEditor();

        h.testApp.sendKey("Ctrl+P");
        h.testApp.render();

        expect(picker().items.map((item) => [item.label, item.description])).toEqual([
            ["b.ts", ""],
            ["c.ts", "src"],
            ["a.ts", ""],
        ]);
    });

    it("Ctrl+E Ctrl+E Enter returns to the previous file; the typed query stays", async () => {
        h.workbench.focusEditor();

        h.testApp.sendKey("Ctrl+E");
        h.testApp.sendKey("Ctrl+E");
        h.testApp.render();
        expect(picker().selectedIndex).toBe(1);
        expect(picker().getQuery()).toBe("");

        h.testApp.sendKey("Enter");
        await flushMicrotasks(2);
        h.testApp.render();

        expect(h.testApp.root.overlayLayer.hasVisibleItems()).toBe(false);
        expect(activeFile()).toBe(ws.path("b.ts"));
    });

    it("Ctrl+P inside the picker steps down, Ctrl+Shift+P back up", () => {
        h.workbench.focusEditor();

        h.testApp.sendKey("Ctrl+P");
        h.testApp.sendKey("Ctrl+P");
        h.testApp.sendKey("Ctrl+P");
        h.testApp.render();
        expect(picker().selectedIndex).toBe(2);

        h.testApp.sendKey("Ctrl+Shift+P");
        h.testApp.render();
        expect(picker().selectedIndex).toBe(1);
        expect(h.testApp.root.overlayLayer.hasVisibleItems()).toBe(true);
    });

    it("quickOpenPreviousEditor opens with the cursor on the previous file", () => {
        h.commands.execute("workbench.action.quickOpenPreviousEditor");
        h.testApp.render();

        expect(picker().items[picker().selectedIndex].label).toBe("b.ts");
    });

    it("a query shows the matching history first, then other files", () => {
        h.commands.execute("workbench.action.quickOpen", "ts");
        h.testApp.render();

        const labels = picker().items.map((item) => item.label);
        expect(labels.slice(0, 3)).toEqual(["c.ts", "b.ts", "a.ts"]);
        expect(new Set(labels).size).toBe(labels.length);
    });
});
