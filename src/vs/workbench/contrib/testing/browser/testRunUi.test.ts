import { describe, expect, it } from "vitest";

import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import type { NotificationService } from "../../../services/notification/browser/notificationService.ts";

import { TestRunUi } from "./testRunUi.ts";

function setup(saveBeforeTest: unknown) {
    const commands = new CommandRegistry();
    const saves: number[] = [];
    let finish = (): void => undefined;
    commands.register("workbench.action.files.saveAll", () => {
        saves.push(saves.length);
        return new Promise<void>((resolve) => {
            finish = resolve;
        });
    });
    const toasts: unknown[] = [];
    const ui = new TestRunUi(
        commands,
        {
            get: (key: string) => (key === "testing.saveBeforeTest" ? saveBeforeTest : undefined),
        } as IConfigurationService,
        { show: (toast: unknown) => toasts.push(toast) } as unknown as NotificationService,
    );
    return {
        ui,
        saves,
        toasts,
        finish: () => {
            finish();
        },
    };
}

describe("TestRunUi", () => {
    it("testing.saveBeforeTest on: Save All, and the run waits for it", async () => {
        const { ui, saves, finish } = setup(true);
        let saved = false;
        const saving = ui.saveAllBeforeTest().then(() => {
            saved = true;
        });
        expect(saves).toEqual([0]);
        await Promise.resolve();
        expect(saved).toBe(false);
        finish();
        await saving;
        expect(saved).toBe(true);
    });

    it("testing.saveBeforeTest off: nothing is saved", async () => {
        const { ui, saves } = setup(false);
        await ui.saveAllBeforeTest();
        expect(saves).toEqual([]);
    });

    it("an error is an error toast", () => {
        const { ui, toasts } = setup(true);
        ui.showError("An error occurred attempting to run tests: boom");
        expect(toasts).toEqual([
            { severity: "error", message: "An error occurred attempting to run tests: boom", modal: false, items: [] },
        ]);
    });
});
