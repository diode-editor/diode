import { Disposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { ServiceAccessorDIToken, token } from "../../../../platform/instantiation/common/diContainer.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import type { IWorkbenchContribution } from "../../../common/iWorkbenchContribution.ts";
import { NotificationServiceDIToken } from "../../../services/notification/browser/notificationService.ts";
import { ExtensionsWorkbenchServiceDIToken } from "../common/extensionsWorkbench.ts";

import { ExtensionPageActionsDIToken } from "./extensionPageActions.ts";

/** Upstream `INSTALL_EXTENSION_FROM_VSIX_COMMAND_ID`: extensions call it (CodeLLDB installs its platform package). */
export const INSTALL_FROM_VSIX_COMMAND_ID = "workbench.extensions.command.installFromVSIX";

/**
 * Upstream takes `URI | URI[]`; from an extension a `vscode.Uri` arrives as its structured clone (`scheme`, `path`
 * and the rest as plain fields). A plain string is a path (a deviation, for callers without a URI at hand). Only
 * `file:` can be installed.
 */
export function vsixPathsOf(resources: unknown): string[] {
    const list: unknown[] = Array.isArray(resources) ? resources : [resources];
    return list.map((resource) => {
        if (typeof resource === "string") return resource;
        const uri = isUriLike(resource) ? Uri.from(resource) : undefined;
        if (uri?.scheme === "file") return uri.fsPath;
        const shown = uri?.toString() ?? JSON.stringify(resource);
        throw new Error(`Cannot install a VSIX from ${shown}: expected a file URI or a path`);
    });
}

function isUriLike(value: unknown): value is Uri {
    return typeof value === "object" && value !== null && typeof (value as Uri).path === "string";
}

/**
 * Upstream `installFromVSIX` command: all at once, the first failure is thrown with its reason (the caller — an
 * extension — shows it); success is announced, with `Reload Now` when something waits for a reload.
 */
export async function installFromVsix(accessor: ServiceAccessor, resources: unknown): Promise<void> {
    const paths = vsixPathsOf(resources);
    const service = accessor.get(ExtensionsWorkbenchServiceDIToken);
    const results = await Promise.allSettled(paths.map((vsixPath) => service.installVsix(vsixPath)));
    let needsReload = false;
    for (const result of results) {
        if (result.status === "rejected") throw result.reason;
        needsReload ||= result.value.needsReload;
    }
    const plural = paths.length > 1;
    const notifications = accessor.get(NotificationServiceDIToken);
    if (!needsReload) {
        const message = plural ? "Completed installing extensions." : "Completed installing extension.";
        notifications.show({ severity: "info", message, modal: false, items: [] });
        return;
    }
    const handle = notifications.show({
        severity: "info",
        message: plural
            ? "Completed installing extensions. Please reload Diode to enable them."
            : "Completed installing extension. Please reload Diode to enable it.",
        modal: false,
        items: ["Reload Now"],
    });
    // Not awaited: the install is done, the notification may wait for an answer for long.
    void handle.answered.then((choice) => {
        if (choice === 0) accessor.get(ExtensionPageActionsDIToken).reloadWindow();
    });
}

/**
 * Upstream `workbench.extensions.action.installVSIX` opens a file dialog; a terminal has none, so the path is typed
 * in a quick input (deviation). A failure is a notification: nobody awaits a palette command.
 */
export const installVsixAction: CommandAction = {
    id: "workbench.extensions.action.installVSIX",
    title: "Extensions: Install from VSIX...",
    async run(accessor) {
        const input = await accessor.get(QuickInputServiceDIToken).input({
            title: "Install from VSIX",
            placeholder: "Path to a .vsix file",
        });
        // An empty path is a cancel, like closing the dialog.
        const vsixPath = input?.trim() ?? "";
        if (vsixPath === "") return;
        try {
            await installFromVsix(accessor, vsixPath);
        } catch (error) {
            accessor.get(NotificationServiceDIToken).show({
                severity: "error",
                message: error instanceof Error ? error.message : String(error),
                modal: false,
                items: [],
            });
        }
    },
};

export const ExtensionVsixContributionDIToken = token<ExtensionVsixContribution>("ExtensionVsixContribution");

/** No title, so not in the palette (upstream: only the explorer context menu of a `.vsix`). */
export class ExtensionVsixContribution extends Disposable implements IWorkbenchContribution {
    public static dependencies = [CommandRegistryDIToken, ServiceAccessorDIToken] as const;

    public constructor(commands: CommandRegistry, accessor: ServiceAccessor) {
        super();
        this.register(
            commands.register(INSTALL_FROM_VSIX_COMMAND_ID, (resources) => installFromVsix(accessor, resources)),
        );
    }
}
