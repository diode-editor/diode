import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { ServiceAccessorDIToken, token } from "../../../../platform/instantiation/common/diContainer.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import type { IWorkbenchContribution } from "../../../common/iWorkbenchContribution.ts";
import { NotificationServiceDIToken } from "../../../services/notification/browser/notificationService.ts";
import type { IExtensionListEntry, IExtensionsWorkbenchService } from "../common/extensionsWorkbench.ts";
import { ExtensionsWorkbenchServiceDIToken } from "../common/extensionsWorkbench.ts";

import { ExtensionPageActionsDIToken } from "./extensionPageActions.ts";
import { ExtensionsComponentDIToken } from "./extensionsComponent.ts";

/** Upstream `InstallAnotherVersionAction.ID`: the page button's command, with the extension id as its argument. */
export const INSTALL_ANOTHER_VERSION_COMMAND_ID = "workbench.extensions.action.install.anotherVersion";

const CAN_INSTALL_SPECIFIC_VERSION = "extensionsCanInstallSpecificVersion";

/**
 * Upstream `InstallSpecificVersionOfExtensionAction.enabled`: some installed extension came from the gallery.
 * Until the catalog is read (no network at startup) a profile entry doesn't say where it came from, so any
 * installed extension counts; the command reads the catalog and then lists only the ones the registry knows.
 */
export function canInstallSpecificVersion(entries: readonly IExtensionListEntry[]): boolean {
    const catalogRead = entries.some((e) => e.latestVersion !== null);
    return entries.some((e) => e.installedVersion !== null && (e.latestVersion !== null || !catalogRead));
}

function notifyError(accessor: ServiceAccessor, message: string): void {
    accessor.get(NotificationServiceDIToken).show({ severity: "error", message, modal: false, items: [] });
}

/**
 * Upstream `InstallAnotherVersionAction.run` off the extension page (on the page the pane runs the same two
 * steps itself, to show progress and errors in place). `true` means a version was installed.
 */
async function installAnotherVersion(accessor: ServiceAccessor, id: string): Promise<boolean> {
    const actions = accessor.get(ExtensionPageActionsDIToken);
    let version: string | undefined;
    try {
        version = await actions.pickVersion(id);
    } catch (error) {
        notifyError(accessor, error instanceof Error ? error.message : String(error));
        return false;
    }
    if (version === undefined) return false;
    const result = await actions.install(id, { version });
    if (!result.ok) notifyError(accessor, result.error);
    return result.ok;
}

export const installSpecificVersionOfExtensionAction: CommandAction = {
    id: "workbench.extensions.action.install.specificVersion",
    title: "Extensions: Install Specific Version of Extension...",
    enablement: CAN_INSTALL_SPECIFIC_VERSION,
    async run(accessor) {
        const service = accessor.get(ExtensionsWorkbenchServiceDIToken);
        await service.ensureLoaded();
        const installed = service
            .getEntries()
            .filter((e) => e.installedVersion !== null && e.latestVersion !== null)
            .sort((a, b) => a.displayName.localeCompare(b.displayName));
        if (installed.length === 0) {
            // Deviation: upstream never gets here, its command is disabled; ours could only guess before the catalog.
            accessor.get(NotificationServiceDIToken).show({
                severity: "info",
                message: "There are no installed extensions from the marketplace.",
                modal: false,
                items: [],
            });
            return;
        }
        const pick = await accessor.get(QuickInputServiceDIToken).quickPick({
            placeholder: "Select Extension",
            items: installed.map((e) => ({ label: e.displayName, description: e.id })),
        });
        const id = pick?.description;
        if (id === undefined) return;
        // Upstream then opens the extension in the viewlet search; the page also carries `Reload Window`.
        if (await installAnotherVersion(accessor, id)) {
            await accessor.get(ExtensionsComponentDIToken).openExtensionPage(id);
        }
    },
};

export const ExtensionVersionContributionDIToken = token<ExtensionVersionContribution>("ExtensionVersionContribution");

/** The page command has no title, so it is not in the palette (upstream: not in `f1`). */
export class ExtensionVersionContribution extends Disposable implements IWorkbenchContribution {
    public static dependencies = [
        ExtensionsWorkbenchServiceDIToken,
        ContextKeyServiceDIToken,
        CommandRegistryDIToken,
        ServiceAccessorDIToken,
    ] as const;

    public constructor(
        service: IExtensionsWorkbenchService,
        contextKeys: ContextKeyService,
        commands: CommandRegistry,
        accessor: ServiceAccessor,
    ) {
        super();
        const update = (): void => {
            contextKeys.set(CAN_INSTALL_SPECIFIC_VERSION, canInstallSpecificVersion(service.getEntries()));
        };
        update();
        this.register(service.onDidChange(update));
        this.register(
            commands.register(INSTALL_ANOTHER_VERSION_COMMAND_ID, async (id?: unknown) => {
                if (typeof id === "string") await installAnotherVersion(accessor, id);
            }),
        );
    }
}
