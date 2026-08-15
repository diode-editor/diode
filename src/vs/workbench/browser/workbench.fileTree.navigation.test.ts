import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { TreeViewElement } from "@tuidom/elements/tree/treeViewElement";
import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";

// End-to-end keyboard navigation in the file tree (issue #33): keys travel the real
// path — raw escape sequence → parser → keybinding dispatch → list.* command.

const FILE_COUNT = 40;

function createWorkspace(): ITempWorkspace {
    const ws = createTempWorkspace({ prefix: "diode-tree-nav-" });
    for (let i = 0; i < FILE_COUNT; i++) {
        ws.writeFile(`file-${String(i).padStart(2, "0")}.txt`, `content ${String(i)}`);
    }
    return ws;
}

describe("FileTree keyboard navigation — PgUp/PgDown, Home/End", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let tree: TreeViewElement<unknown>;

    beforeEach(async () => {
        ws = createWorkspace();
        h = createAppTestHarness({ workspaceFolder: ws.dir });
        await h.workbench.activate();
        h.testApp.render();
        tree = h.testApp.querySelector("TreeViewElement") as unknown as TreeViewElement<unknown>;
        tree.focus();
        h.testApp.render();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    function selectedIndex(): number {
        return (tree as unknown as { selectedIndex: number }).selectedIndex;
    }

    it("PageDown moves selection down a page", () => {
        h.testApp.sendKey("PageDown");
        h.testApp.render();
        expect(selectedIndex()).toBeGreaterThan(0);
    });

    it("PageUp moves selection back up", () => {
        h.testApp.sendKey("PageDown");
        h.testApp.render();
        const after = selectedIndex();
        expect(after).toBeGreaterThan(0);

        h.testApp.sendKey("PageUp");
        h.testApp.render();
        expect(selectedIndex()).toBeLessThan(after);
    });

    it("End moves selection to the last item", () => {
        h.testApp.sendKey("End");
        h.testApp.render();
        expect(selectedIndex()).toBe(FILE_COUNT - 1);
    });

    it("Home moves selection back to the first item", () => {
        h.testApp.sendKey("End");
        h.testApp.render();
        expect(selectedIndex()).toBe(FILE_COUNT - 1);

        h.testApp.sendKey("Home");
        h.testApp.render();
        expect(selectedIndex()).toBe(0);
    });

    it("navigation keys still work in the tree while an editor is open", () => {
        h.testApp.sendKey("Enter"); // open selected file — focus moves to the editor
        h.testApp.render();
        tree.focus();
        h.testApp.render();

        h.testApp.sendKey("End");
        h.testApp.render();
        expect(selectedIndex()).toBe(FILE_COUNT - 1);

        h.testApp.sendKey("PageUp");
        h.testApp.render();
        expect(selectedIndex()).toBeLessThan(FILE_COUNT - 1);
    });

    it("kitty-encoded keys (explicit press event type) work too", () => {
        h.testApp.backend.sendRaw("\x1b[6;1:1~"); // PageDown, kitty event-type syntax
        h.testApp.render();
        expect(selectedIndex()).toBeGreaterThan(0);

        h.testApp.backend.sendRaw("\x1b[1;1:1~"); // Home
        h.testApp.render();
        expect(selectedIndex()).toBe(0);
    });
});
