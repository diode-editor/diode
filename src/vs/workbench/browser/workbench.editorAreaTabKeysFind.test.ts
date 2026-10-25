import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { EditorServiceDIToken } from "../services/editor/common/editorService.ts";

/**
 * Tab keys (#818) from the Find widget: it sits inside the editor area, so editorAreaFocus is true there and the
 * keys switch tabs. After the switch the keyboard must land in the new tab, not in the hidden one.
 */
describe("Workbench: tab keys from the Find widget of a text tab", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-tab-keys-find-", files: { "a.txt": "alpha\n", "b.txt": "beta\n" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir });
        h.workbench.openFile(ws.path("a.txt"));
        h.workbench.openFile(ws.path("b.txt"));
        h.workbench.focusEditor();
        h.commands.execute("actions.find");
        h.testApp.render();
        expect(h.testApp.querySelector("#findWidget")).toBeTruthy();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    const activeLabel = (): string | undefined => h.container.get(EditorServiceDIToken).getActivePane()?.label;
    const screen = (): string => {
        h.testApp.render();
        return h.testApp.backend.screenToString();
    };

    it.each(["Ctrl+PageUp", "Ctrl+6"])(
        "%s switches to a.txt and typing goes into a.txt, not the hidden b.txt",
        (key) => {
            h.testApp.sendKey(key);
            h.testApp.render();
            expect(activeLabel()).toBe("a.txt");

            h.testApp.sendKey("Q");
            const frame = screen();
            expect(frame).toContain("Qalpha");
            expect(frame).not.toContain("b.txt ●");

            // The keyboard still drives the tabs: switching back shows b.txt clean.
            h.testApp.sendKey("Ctrl+PageDown");
            expect(activeLabel()).toBe("b.txt");
            expect(screen()).not.toContain("Qbeta");
        },
    );
});
