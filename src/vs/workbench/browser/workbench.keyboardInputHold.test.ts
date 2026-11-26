import { afterEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";
import { EditorServiceDIToken } from "../services/editor/common/editorService.ts";

/** The workbench attaches the hold: a key typed during it reaches the editor only after the release (#967). */
describe("Workbench: keys during an input hold", () => {
    let ws: ITempWorkspace | undefined;
    let h: IAppHarness | undefined;

    afterEach(() => {
        h?.dispose();
        ws?.dispose();
    });

    it("a typed key waits for the hold to end and then lands in the editor", async () => {
        ws = createTempWorkspace({ prefix: "diode-input-hold-", files: { "a.txt": "\n" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir, openFile: ws.path("a.txt") });
        h.workbench.focusEditor();
        const text = (): string | undefined =>
            h?.container.get(EditorServiceDIToken).getActiveTabEditor()?.model.document.getText();

        let release = (): void => undefined;
        const done = new Promise<void>((resolve) => {
            release = resolve;
        });
        h.container.get(CommandRegistryDIToken).holdInputUntil(done);
        h.testApp.sendKey("z");
        expect(text()).toBe("\n");

        release();
        await done;
        await Promise.resolve();
        expect(text()).toBe("z\n");
    });
});
