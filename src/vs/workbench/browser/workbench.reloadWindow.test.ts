import { describe, expect, it, vi } from "vitest";

import { createAppTestHarness } from "../../../TestUtils/AppTestHarness.ts";
import { DialogServiceDIToken } from "../services/dialogs/browser/dialogService.ts";
import { HostProcessDIToken } from "../services/lifecycle/common/hostProcess.ts";

/** The process restart itself is unit-tested in `base/node/restartProcess.test.ts`; here the seam is stubbed. */

/** Harness with a stubbed reload seam: the real one would take the runner down. */
function createHarness(): { harness: ReturnType<typeof createAppTestHarness>; reloadWindow: () => void } {
    const reloadWindow = vi.fn();
    const harness = createAppTestHarness({
        containerOverrides: (container) => {
            container.bind(HostProcessDIToken, () => ({ exit: () => undefined, restart: reloadWindow }));
        },
    });
    return { harness, reloadWindow };
}

/** Continuation after the dialog answer and the participants' shutdown run as microtasks (LifecycleService is async). */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("Workbench: window reload", () => {
    it("without unsaved tabs the command reloads with no dialogs", async () => {
        const { harness, reloadWindow } = createHarness();

        harness.commands.execute("workbench.action.reloadWindow");
        await tick();

        expect(reloadWindow).toHaveBeenCalledOnce();
    });

    it("an unsaved tab is asked about first; the window does not reload silently", () => {
        const { harness, reloadWindow } = createHarness();
        harness.workbench.openFile("/tmp/reload-dirty.txt");
        harness.workbench.focusEditor();
        harness.testApp.sendKey("x");

        harness.commands.execute("workbench.action.reloadWindow");

        expect(harness.testApp.querySelector("#confirmSaveDialog")).not.toBeNull();
        expect(reloadWindow).not.toHaveBeenCalled();
    });

    it("Don't Save in the dialog carries the reload through to the seam", async () => {
        const { harness, reloadWindow } = createHarness();
        harness.workbench.openFile("/tmp/reload-dontsave.txt");
        harness.workbench.focusEditor();
        harness.testApp.sendKey("x");

        harness.commands.execute("workbench.action.reloadWindow");
        const dialog = harness.container.get(DialogServiceDIToken).getOpenConfirmSaveDialog()!;
        dialog.onDontSave?.();
        await tick();

        expect(reloadWindow).toHaveBeenCalledOnce();
    });

    it("Cancel leaves the window in place", async () => {
        const { harness, reloadWindow } = createHarness();
        harness.workbench.openFile("/tmp/reload-cancel.txt");
        harness.workbench.focusEditor();
        harness.testApp.sendKey("x");

        harness.commands.execute("workbench.action.reloadWindow");
        const dialog = harness.container.get(DialogServiceDIToken).getOpenConfirmSaveDialog()!;
        dialog.onCancel?.();
        await tick();

        expect(reloadWindow).not.toHaveBeenCalled();
    });
});
