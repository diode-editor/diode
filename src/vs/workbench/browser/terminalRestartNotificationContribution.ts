import { Disposable } from "../../base/common/lifecycle.ts";
import { type CommandRegistry, CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";
import type { IConfigurationService } from "../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { token } from "../../platform/instantiation/common/diContainer.ts";
import type { IWorkbenchContribution } from "../common/iWorkbenchContribution.ts";
import type { NotificationService } from "../services/notification/browser/notificationService.ts";
import { NotificationServiceDIToken } from "../services/notification/browser/notificationService.ts";

export const TerminalRestartNotificationContributionDIToken =
    // Stryker disable next-line StringLiteral: token() returns a new Token and dependencies resolve by reference to it — the string inside is only a debug label
    token<TerminalRestartNotificationContribution>("TerminalRestartNotificationContribution");

/** Settings read once at startup: the keyboard protocols are not switched mid-session (#1049). */
const RESTART_SETTINGS = ["terminal.tier", "terminal.capabilities"] as const;

/** A live change of a startup-only terminal setting asks for a restart; Reload Window restarts the process in place. */
export class TerminalRestartNotificationContribution extends Disposable implements IWorkbenchContribution {
    public static dependencies = [
        IConfigurationServiceDIToken,
        NotificationServiceDIToken,
        CommandRegistryDIToken,
    ] as const;

    public constructor(
        configuration: IConfigurationService,
        notifications: NotificationService,
        commands: CommandRegistry,
    ) {
        super();
        this.register(
            configuration.onDidChangeConfiguration((event) => {
                for (const key of RESTART_SETTINGS) {
                    if (!event.affectsConfiguration(key)) continue;
                    const handle = notifications.show({
                        severity: "info",
                        message: `Restart Diode to apply ${key}`,
                        modal: false,
                        items: ["Reload Window"],
                    });
                    void handle.answered.then((choice) => {
                        if (choice === 0) void commands.execute("workbench.action.reloadWindow");
                    });
                }
            }),
        );
    }
}
