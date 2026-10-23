import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { detectIndentation } from "../../editor/common/model/indentationDetector.ts";

// The real detector with call tracking: the test is about how often opening a file runs it.
vi.mock("../../editor/common/model/indentationDetector.ts", { spy: true });

/** Opening a file detects indentation once: the pane is built with the `editor.*` baseline instead of applying it afterwards. */
describe("Workbench — indentation detection on open", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-indent-once-",
            files: { "a.ts": "function f() {\n  return 1;\n}\n" },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir });
        vi.mocked(detectIndentation).mockClear();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("runs the detector once per opened file and still lets the file win", () => {
        h.workbench.openFile(ws.path("a.ts"));
        h.testApp.render();

        expect(vi.mocked(detectIndentation)).toHaveBeenCalledTimes(1);
        expect(h.activeEditor().viewState.tabSize).toBe(2);
        expect(h.activeEditor().viewState.insertSpaces).toBe(true);
    });
});
