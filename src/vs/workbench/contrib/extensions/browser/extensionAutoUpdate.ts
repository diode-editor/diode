import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { IClock } from "../../../../platform/clock/common/clock.ts";
import { ClockDIToken } from "../../../../platform/clock/common/clock.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { ServiceAccessorDIToken, token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { ILogService } from "../../../../platform/log/common/iLogService.ts";
import { ILogServiceDIToken } from "../../../../platform/log/common/iLogServiceDIToken.ts";
import type { IWorkbenchContribution } from "../../../common/iWorkbenchContribution.ts";
import type { NotificationService } from "../../../services/notification/browser/notificationService.ts";
import { NotificationServiceDIToken } from "../../../services/notification/browser/notificationService.ts";
import {
    AUTO_CHECK_UPDATES_SETTING,
    AUTO_UPDATE_DELAY_SETTING,
    AUTO_UPDATE_SETTING,
    type AutoUpdateValue,
    toAutoUpdateValue,
} from "../common/extensionAutoUpdate.ts";
import type { IExtensionsWorkbenchService } from "../common/extensionsWorkbench.ts";
import { ExtensionsWorkbenchServiceDIToken } from "../common/extensionsWorkbench.ts";
import type { IAutoUpdateSettings } from "../common/extensionUpdateScheduler.ts";
import { ExtensionUpdateScheduler, ExtensionUpdateSchedulerDIToken } from "../common/extensionUpdateScheduler.ts";

import { ExtensionPageActionsDIToken } from "./extensionPageActions.ts";
import { describeUpdateAllResult } from "./extensionUpdateActions.ts";

/** Upstream `ToggleAutoUpdateForExtensionAction.ID`: the page toggle's command, with the extension id as its argument. */
export const TOGGLE_AUTO_UPDATE_COMMAND_ID = "workbench.extensions.action.toggleAutoUpdateForExtension";

const SETTINGS = [AUTO_CHECK_UPDATES_SETTING, AUTO_UPDATE_SETTING, AUTO_UPDATE_DELAY_SETTING] as const;

export class ConfigurationAutoUpdateSettings implements IAutoUpdateSettings {
    public constructor(private readonly configuration: IConfigurationService) {}

    public autoCheckUpdates(): boolean {
        return this.configuration.get(AUTO_CHECK_UPDATES_SETTING);
    }

    public autoUpdate(): AutoUpdateValue {
        return toAutoUpdateValue(this.configuration.get(AUTO_UPDATE_SETTING));
    }

    public autoUpdateDelayHours(): number {
        return this.configuration.get(AUTO_UPDATE_DELAY_SETTING);
    }

    public onDidChange(listener: (key: string) => void): IDisposable {
        return this.configuration.onDidChangeConfiguration((event) => {
            for (const key of SETTINGS) if (event.affectsConfiguration(key)) listener(key);
        });
    }
}

/**
 * The batch's one notification is ours: upstream is silent, its activity bar has a badge and it restarts the
 * extension host; here neither exists, so `Reload Window` is the way to the new versions (the same text as
 * `Update All`). The window is never reloaded on its own.
 */
export class WorkbenchExtensionUpdateScheduler extends ExtensionUpdateScheduler {
    public static dependencies = [
        ExtensionsWorkbenchServiceDIToken,
        IConfigurationServiceDIToken,
        ClockDIToken,
        NotificationServiceDIToken,
        CommandRegistryDIToken,
        ILogServiceDIToken,
    ] as const;

    public constructor(
        service: IExtensionsWorkbenchService,
        configuration: IConfigurationService,
        clock: IClock,
        notifications: Pick<NotificationService, "show">,
        commands: CommandRegistry,
        logService: ILogService,
    ) {
        super({
            service,
            settings: new ConfigurationAutoUpdateSettings(configuration),
            clock,
            logger: logService.createLogger("extensions", { label: "Extensions" }),
            onDidUpdate: (result) => {
                const handle = notifications.show(describeUpdateAllResult(result));
                void handle.answered.then((choice) => {
                    // The page button's path: one reload command for everything.
                    if (choice === 0) commands.execute("workbench.action.reloadWindow");
                });
            },
        });
    }
}

export const ExtensionAutoUpdateContributionDIToken = token<ExtensionAutoUpdateContribution>(
    "ExtensionAutoUpdateContribution",
);

/**
 * The `eventually` phase: the background checks start after the first frame. The scheduler itself lives longer
 * (the page reads it, and catalog reads before this phase still auto-update), so it is not disposed here.
 */
export class ExtensionAutoUpdateContribution extends Disposable implements IWorkbenchContribution {
    public static dependencies = [
        ExtensionUpdateSchedulerDIToken,
        ExtensionsWorkbenchServiceDIToken,
        CommandRegistryDIToken,
        ServiceAccessorDIToken,
    ] as const;

    public constructor(
        scheduler: ExtensionUpdateScheduler,
        service: IExtensionsWorkbenchService,
        commands: CommandRegistry,
        accessor: ServiceAccessor,
    ) {
        super();
        scheduler.start();
        // No title, so not in the palette (upstream: not in `f1`); the page button runs the same action.
        this.register(
            commands.register(TOGGLE_AUTO_UPDATE_COMMAND_ID, async (id?: unknown) => {
                const entry = service.getEntries().find((e) => e.id === id && e.installedVersion !== null);
                if (entry === undefined) return;
                await accessor.get(ExtensionPageActionsDIToken).setAutoUpdate(entry.id, entry.pinned);
            }),
        );
    }
}
