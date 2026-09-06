import { describe, expect, it, vi } from "vitest";

import { createAppTestHarness } from "../../../TestUtils/AppTestHarness.ts";
import { DialogServiceDIToken } from "../services/dialogs/browser/dialogService.ts";
import { WindowReloadHandlerDIToken } from "../services/lifecycle/common/windowReload.ts";

/**
 * Перезагрузка окна сквозь настоящий workbench: команда → протокол прощания
 * (несохранённые вкладки) → шов владельца процесса. Сам перезапуск процесса
 * проверяется юнитами `base/node/restartProcess.test.ts` — здесь шов подменён.
 */

/** Харнесс с подменённым швом перезагрузки: настоящий унёс бы раннер. */
function createHarness(): { harness: ReturnType<typeof createAppTestHarness>; reloadWindow: () => void } {
    const reloadWindow = vi.fn();
    const harness = createAppTestHarness({
        containerOverrides: (container) => {
            container.bind(WindowReloadHandlerDIToken, () => ({ reloadWindow }));
        },
    });
    return { harness, reloadWindow };
}

/** Продолжение после ответа в диалоге откладывается на микротаск (LifecycleService async). */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("Workbench — перезагрузка окна", () => {
    it("без несохранённых вкладок команда перезагружает сразу", () => {
        const { harness, reloadWindow } = createHarness();

        harness.commands.execute("workbench.action.reloadWindow");

        expect(reloadWindow).toHaveBeenCalledOnce();
    });

    it("несохранённая вкладка сперва спрашивается — окно не перезагружается молча", () => {
        const { harness, reloadWindow } = createHarness();
        harness.workbench.openFile("/tmp/reload-dirty.txt");
        harness.workbench.focusEditor();
        harness.testApp.sendKey("x");

        harness.commands.execute("workbench.action.reloadWindow");

        expect(harness.testApp.querySelector("#confirmSaveDialog")).not.toBeNull();
        expect(reloadWindow).not.toHaveBeenCalled();
    });

    it("Don't Save в диалоге доводит перезагрузку до шва", async () => {
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

    it("Cancel оставляет окно на месте", async () => {
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
