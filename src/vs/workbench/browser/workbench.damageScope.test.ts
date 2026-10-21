import { TreeViewElement } from "@tuidom/elements/tree/treeViewElement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";

// Mechanism: the consumed-key safety-net fallback (workbenchComponent.mount): a command
// that properly marks its widget yields partial damage instead of markDirty on the root.

describe("Workbench — damage from a key in the editor does not touch other panels", () => {
    let h: IAppHarness;

    beforeEach(() => {
        h = createAppTestHarness();
    });

    afterEach(() => {
        h.dispose();
    });

    it("an arrow key in the editor does not render the file tree", () => {
        h.workbench.openFile("/tmp/damage-scope.txt");
        h.workbench.focusEditor();
        h.testApp.render();

        const treeRenderSpy = vi.spyOn(TreeViewElement.prototype, "render");
        h.testApp.sendKey("ArrowDown");

        // A frame happened (cursor movement is dirty), but the file tree wasn't in it.
        expect(treeRenderSpy).not.toHaveBeenCalled();
        treeRenderSpy.mockRestore();
    });
});
