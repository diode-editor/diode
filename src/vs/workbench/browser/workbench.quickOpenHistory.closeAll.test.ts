import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";

import type { QuickPickElement } from "./parts/quickinput/quickPickElement.ts";

describe("Workbench: Quick Open history after Close All Editors", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    function picker(): QuickPickElement {
        return h.testApp.querySelector("QuickPickElement") as QuickPickElement;
    }

    beforeEach(async () => {
        ws = createTempWorkspace({
            prefix: "diode-quickopen-history-close-all-",
            files: { "a.ts": "a", "b.ts": "b", "c.ts": "c" },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir });
        await h.workbench.activate();
        await h.workbench.fileIndexReady;
        for (const name of ["a.ts", "b.ts", "c.ts"]) h.commands.execute("workbench.openFile", ws.path(name));
        h.testApp.render();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
        vi.restoreAllMocks();
    });

    it("closing all editors keeps the MRU order: the last active file stays on top", async () => {
        // Upstream closes the inactive editors first, so nothing is activated on the way out.
        // Live repro: open a.ts, b.ts, c.ts; View: Close All Editors; Ctrl+P lists a.ts first.
        await h.commands.execute("workbench.action.closeAllEditors");
        h.testApp.render();

        h.testApp.sendKey("Ctrl+P");
        h.testApp.render();

        expect(picker().items.map((item) => item.label)).toEqual(["c.ts", "b.ts", "a.ts"]);
    });
});
