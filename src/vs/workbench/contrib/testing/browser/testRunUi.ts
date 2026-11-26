import { type CommandRegistry, CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import {
    type NotificationService,
    NotificationServiceDIToken,
} from "../../../services/notification/browser/notificationService.ts";
import type { ITestRunUi } from "../common/testService.ts";

/** Upstream `saveAllBeforeTest` through the workbench's Save All, and the run's error toast. */
export class TestRunUi implements ITestRunUi {
    public static dependencies = [
        CommandRegistryDIToken,
        IConfigurationServiceDIToken,
        NotificationServiceDIToken,
    ] as const;

    public constructor(
        private readonly commands: CommandRegistry,
        private readonly configuration: IConfigurationService,
        private readonly notifications: NotificationService,
    ) {}

    public async saveAllBeforeTest(): Promise<void> {
        if (!this.configuration.get("testing.saveBeforeTest")) return;
        await this.commands.execute("workbench.action.files.saveAll");
    }

    public showError(message: string): void {
        this.notifications.show({ severity: "error", message, modal: false, items: [] });
    }
}
