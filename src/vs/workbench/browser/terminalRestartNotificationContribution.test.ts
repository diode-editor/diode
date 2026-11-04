import { describe, expect, it, vi } from "vitest";

import { createTestConfigurationService } from "../../../TestUtils/testConfigurationService.ts";
import { CommandRegistry } from "../../platform/commands/common/commandRegistry.ts";
import { NotificationService } from "../services/notification/browser/notificationService.ts";

import { TerminalRestartNotificationContribution } from "./terminalRestartNotificationContribution.ts";

function setup() {
    const configuration = createTestConfigurationService();
    const notifications = new NotificationService();
    const commands = new CommandRegistry();
    const executed: string[] = [];
    commands.register("workbench.action.reloadWindow", () => {
        executed.push("reload");
    });
    new TerminalRestartNotificationContribution(configuration, notifications, commands);
    return { configuration, notifications, executed };
}

describe("TerminalRestartNotificationContribution", () => {
    it.each<[string, unknown]>([
        ["terminal.tier", "kitty"],
        ["terminal.capabilities", { "extended-keys": true }],
    ])("changing %s asks for a restart; Reload Window reloads", async (key, value) => {
        const { configuration, notifications, executed } = setup();

        await configuration.updateValue(key, value);

        const shown = notifications.current();
        expect(shown?.message).toBe(`Restart Diode to apply ${key}`);
        expect(shown).toMatchObject({ severity: "info", modal: false, items: ["Reload Window"] });
        notifications.answer(shown?.id ?? -1, 0);
        await vi.waitFor(() => {
            expect(executed).toEqual(["reload"]);
        });
    });

    it("closing it without a choice does not reload", async () => {
        const { configuration, notifications, executed } = setup();
        await configuration.updateValue("terminal.tier", "kitty");

        notifications.dismiss(notifications.current()?.id ?? -1);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(executed).toEqual([]);
    });

    it("other settings do not ask for a restart", async () => {
        const { configuration, notifications } = setup();
        await configuration.updateValue("keyboard.platform", "mac");
        expect(notifications.isEmpty()).toBe(true);
    });
});
