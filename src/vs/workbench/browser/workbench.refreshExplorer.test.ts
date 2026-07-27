import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Offset, Point } from "../../../../tuidom/common/geometryPromitives.ts";
import { TUIContextMenuEvent, TUIMouseEvent } from "../../../../tuidom/dom/events/tuiMouseEvent.ts";
import type { TreeViewElement } from "../../../../tuidom/ui/tree/treeViewElement.ts";
import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../TestUtils/timing.ts";

describe("Workbench — Refresh Explorer", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(async () => {
        ws = createTempWorkspace({ prefix: "vexx-refresh-", files: { "hello.txt": "hi" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir });
        await h.workbench.activate();
        h.testApp.render();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("re-reads the directory so a newly added file becomes visible", async () => {
        // A file created outside the app after the tree was loaded is invisible
        // until the explorer is refreshed.
        expect(h.testApp.backend.screenToString()).not.toContain("aaa-new.txt");

        ws.writeFile("aaa-new.txt", "new");

        h.commands.execute("workbench.files.action.refreshFilesExplorer");
        await flushMicrotasks();
        h.testApp.render();

        expect(h.testApp.backend.screenToString()).toContain("aaa-new.txt");
    });

    it("is reachable from the file tree context menu", async () => {
        const tree = h.testApp.querySelector("TreeViewElement") as TreeViewElement<unknown>;
        tree.focus();
        h.testApp.render();

        // Right-click the first row to open the context menu.
        tree.localPosition = new Offset(0, 0);
        tree.dispatchEvent(
            new TUIContextMenuEvent({ trigger: "mouse", button: "right", screenX: 2, screenY: 0, localX: 2, localY: 0 }),
        );
        h.testApp.render();
        expect(h.testApp.querySelector("PopupMenuElement")).not.toBeNull();

        ws.writeFile("aaa-new.txt", "new");

        // Menu order (no clipboard): New File, New Folder, Copy, Cut, Copy Path,
        // Copy Relative Path, Rename, Delete, Refresh Explorer (separators skipped) —
        // 8 steps down, then Enter.
        for (let i = 0; i < 8; i++) h.testApp.sendKey("ArrowDown");
        h.testApp.sendKey("Enter");
        await flushMicrotasks();
        h.testApp.render();

        expect(h.testApp.querySelector("PopupMenuElement")).toBeNull();
        expect(h.testApp.backend.screenToString()).toContain("aaa-new.txt");
    });
});
