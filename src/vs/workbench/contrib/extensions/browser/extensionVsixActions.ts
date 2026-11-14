import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { ServiceAccessorDIToken, token } from "../../../../platform/instantiation/common/diContainer.ts";
import { reviveWireUri } from "../../../api/common/wireTypes.ts";
import type { IWorkbenchContribution } from "../../../common/iWorkbenchContribution.ts";
import { FileDialogServiceDIToken } from "../../../services/dialogs/browser/fileDialogService.ts";
import { NotificationServiceDIToken } from "../../../services/notification/browser/notificationService.ts";
import { ExtensionsWorkbenchServiceDIToken } from "../common/extensionsWorkbench.ts";

import { ExtensionPageActionsDIToken } from "./extensionPageActions.ts";
import { notifyError } from "./extensionVersionActions.ts";

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
        const uri = reviveWireUri(resource);
        if (uri?.scheme === "file") return uri.fsPath;
        const shown = uri?.toString() ?? JSON.stringify(resource);
        throw new Error(`Cannot install a VSIX from ${shown}: expected a file URI or a path`);
    });
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
    const completed = plural ? "Completed installing extensions." : "Completed installing extension.";
    const reload = plural ? " Please reload Diode to enable them." : " Please reload Diode to enable it.";
    const handle = accessor.get(NotificationServiceDIToken).show({
        severity: "info",
        message: needsReload ? completed + reload : completed,
        modal: false,
        items: needsReload ? ["Reload Now"] : [],
    });
    // Not awaited: the install is done, the notification may wait for an answer for long.
    void handle.answered.then((choice) => {
        if (choice === 0) accessor.get(ExtensionPageActionsDIToken).reloadWindow();
    });
}

/**
 * Upstream `workbench.extensions.action.installVSIX`: the open dialog (ours is the terminal one, with `~`, completion
 * and the `.vsix` filter), then the install command. A failure is a notification: nobody awaits a palette command.
 */
export const installVsixAction: CommandAction = {
    id: "workbench.extensions.action.installVSIX",
    title: "Extensions: Install from VSIX...",
    async run(accessor) {
        const vsixs = await accessor.get(FileDialogServiceDIToken).showOpenDialog({
            title: "Install from VSIX",
            filters: [{ name: "VSIX Extensions", extensions: ["vsix"] }],
            canSelectFiles: true,
            canSelectMany: true,
            openLabel: "Install",
        });
        if (vsixs === undefined) return;
        try {
            await installFromVsix(accessor, vsixs);
        } catch (error) {
            notifyError(accessor, error instanceof Error ? error.message : String(error));
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
