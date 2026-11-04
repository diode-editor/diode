import { Disposable } from "../../../../base/common/lifecycle.ts";
import { type CommandRegistry, CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { NotificationService } from "../../notification/browser/notificationService.ts";
import { NotificationServiceDIToken } from "../../notification/browser/notificationService.ts";
import type { IStatusBarEntryHandle } from "../../statusbar/common/statusBarService.ts";
import type { StatusBarService } from "../../statusbar/common/statusBarService.ts";
import { StatusBarServiceDIToken } from "../../statusbar/common/statusBarService.ts";

import type { TerminalEnvironmentService } from "./terminalEnvironmentService.ts";
import { TerminalEnvironmentServiceDIToken } from "./terminalEnvironmentService.ts";

export const TerminalEnvStatusContributionDIToken = token<TerminalEnvStatusContribution>(
    "TerminalEnvStatusContribution",
);

/** Settings read once at startup: the keyboard protocols are not switched mid-session. */
const RESTART_SETTINGS = ["terminal.tier", "terminal.capabilities"] as const;

export class TerminalEnvStatusContribution extends Disposable {
    public static dependencies = [
        StatusBarServiceDIToken,
        TerminalEnvironmentServiceDIToken,
        CommandRegistryDIToken,
        IConfigurationServiceDIToken,
        NotificationServiceDIToken,
    ] as const;

    private readonly handle: IStatusBarEntryHandle;

    public constructor(
        statusBar: StatusBarService,
        private readonly terminalEnv: TerminalEnvironmentService,
        commands: CommandRegistry,
        configuration: IConfigurationService,
        notifications: NotificationService,
    ) {
        super();
        this.handle = this.register(
            statusBar.addEntry({
                id: "status.terminalEnvironment",
                name: "Terminal Environment",
                text: this.segmentText(),
                alignment: "left",
                priority: 100,
                onClick: () => {
                    void commands.execute("workbench.action.openSettingsJson", {
                        revealSetting: { key: "terminal.tier" },
                    });
                },
            }),
        );
        this.register(
            this.terminalEnv.onDidChange(() => {
                this.handle.update({ text: this.segmentText() });
            }),
        );
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
                    // Reload restarts the process in place: the new setting applies from startup.
                    void handle.answered.then((choice) => {
                        if (choice === 0) void commands.execute("workbench.action.reloadWindow");
                    });
                }
            }),
        );
    }

    private segmentText(): string {
        const env = this.terminalEnv;
        const modes = [...env.getActiveModes()].filter((m) => m !== "local").sort();
        const suffix = modes.length > 0 ? ` · ${modes.join(",")}` : "";
        const rung = env.macKeysRung;
        const mac = rung === undefined ? "" : ` · mac-${rung}`;
        const available = env.availableTier === undefined ? "" : ` · ${env.availableTier} available`;
        return `${env.tier}${mac}${suffix}${available}`;
    }
}
