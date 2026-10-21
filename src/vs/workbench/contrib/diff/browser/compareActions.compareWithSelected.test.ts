import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";

import { resetSelectedForCompare } from "./compareActions.ts";

describe("compareFiles without Select for Compare", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-compare-selected-", files: { "b.txt": "bravo\n" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir });
        resetSelectedForCompare();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("resolves without opening a tab", async () => {
        // Awaited, not fire-and-forget: a guard regression rejects on the null selection, and the
        // registry would swallow the rejection into the log.
        await expect(h.commands.execute("compareFiles", ws.path("b.txt"))).resolves.toBeUndefined();
        expect(h.container.get(EditorServiceDIToken).editorGroups.activeGroup.editorCount).toBe(0);
    });
});
