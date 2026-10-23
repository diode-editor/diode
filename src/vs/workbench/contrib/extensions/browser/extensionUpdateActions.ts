import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { ProgressServiceDIToken } from "../../../../platform/progress/common/progressService.ts";
import { viewMenuVisible } from "../../../browser/actions/menuContexts.ts";
import { SidebarServiceDIToken } from "../../../browser/parts/sidebar/sidebarService.ts";
import type { IWorkbenchContribution } from "../../../common/iWorkbenchContribution.ts";
import type { INotificationMessage } from "../../../services/notification/browser/notificationService.ts";
import { NotificationServiceDIToken } from "../../../services/notification/browser/notificationService.ts";
import type { IExtensionsWorkbenchService, IExtensionUpdateAllResult } from "../common/extensionsWorkbench.ts";
import { ExtensionsWorkbenchServiceDIToken } from "../common/extensionsWorkbench.ts";

import { ExtensionPageActionsDIToken } from "./extensionPageActions.ts";
import { EXTENSIONS_VIEW_ID, EXTENSIONS_VIEWLET_ID, ExtensionsComponentDIToken } from "./extensionsComponent.ts";

/** Upstream `HasOutdatedExtensionsContext`. */
const HAS_OUTDATED_EXTENSIONS = "hasOutdatedExtensions";

/** Upstream group of the container's `...` menu; here the section's, the marketplace container has one section. */
const UPDATES_GROUP = "1_updates";

/** Upstream `openSearch('@outdated ')`: the trailing space lets the user type a filter right after it. */
const OUTDATED_QUERY = "@outdated ";

const UP_TO_DATE_MESSAGE = "All extensions are up to date.";

const RELOAD_WINDOW = "Reload Window";

/** One notification for the whole batch (US-2.7); `Reload Window` once something was updated. */
export function describeUpdateAllResult(result: IExtensionUpdateAllResult): INotificationMessage {
    const { updated, failed } = result;
    const items = updated.length > 0 ? [RELOAD_WINDOW] : [];
    if (failed.length > 0) {
        const reasons = failed.map((f) => `${f.id} — ${f.error}`).join("; ");
        const total = updated.length + failed.length;
        return {
            severity: updated.length > 0 ? "warn" : "error",
            message: `Updated ${String(updated.length)} of ${String(total)} extensions. Failed: ${reasons}`,
            modal: false,
            items,
        };
    }
    if (updated.length === 0) return { severity: "info", message: UP_TO_DATE_MESSAGE, modal: false, items };
    const noun = updated.length === 1 ? "extension" : "extensions";
    return {
        severity: "info",
        message: `Updated ${String(updated.length)} ${noun}. Reload the window to apply.`,
        modal: false,
        items,
    };
}

export const checkForUpdatesAction: CommandAction = {
    id: "workbench.extensions.action.checkForUpdates",
    title: "Extensions: Check for Extension Updates",
    shortTitle: "Check for Extension Updates",
    menus: [{ menuId: MenuId.ViewTitle, group: UPDATES_GROUP, order: 1, visible: viewMenuVisible(EXTENSIONS_VIEW_ID) }],
    async run(accessor) {
        const component = accessor.get(ExtensionsComponentDIToken);
        const service = accessor.get(ExtensionsWorkbenchServiceDIToken);
        await accessor
            .get(ProgressServiceDIToken)
            .withProgress(
                { location: "view", viewId: EXTENSIONS_VIEW_ID, title: "Checking for extension updates" },
                () => component.checkForUpdates(),
            );
        const notifications = accessor.get(NotificationServiceDIToken);
        const showViewlet = (): void => {
            accessor.get(SidebarServiceDIToken).showViewlet(EXTENSIONS_VIEWLET_ID);
        };
        // The previous catalog survives a failed read, so its outdated list would be a stale answer. The viewlet
        // shows the `Retry —` row, like Refresh.
        const error = service.getCatalogError();
        if (error !== null) {
            showViewlet();
            notifications.show({
                severity: "error",
                message: `Could not check for extension updates: ${error}`,
                modal: false,
                items: [],
            });
            return;
        }
        if (service.getOutdated().length > 0) {
            showViewlet();
            component.setQuery(OUTDATED_QUERY);
            return;
        }
        // Upstream `dialogService.info`: a modal with OK.
        notifications.show({ severity: "info", message: UP_TO_DATE_MESSAGE, modal: true, items: [] });
    },
};

export const updateAllExtensionsAction: CommandAction = {
    id: "workbench.extensions.action.updateAllExtensions",
    title: "Extensions: Update All Extensions",
    shortTitle: "Update All Extensions",
    // Upstream `precondition`: the menu item stays, disabled.
    enablement: HAS_OUTDATED_EXTENSIONS,
    menus: [{ menuId: MenuId.ViewTitle, group: UPDATES_GROUP, order: 2, visible: viewMenuVisible(EXTENSIONS_VIEW_ID) }],
    async run(accessor) {
        const service = accessor.get(ExtensionsWorkbenchServiceDIToken);
        const result = await accessor
            .get(ProgressServiceDIToken)
            // Stryker disable next-line StringLiteral: ProgressService only distinguishes "view"; any other location is the window, so replacing the string changes nothing
            .withProgress({ location: "window", title: "Updating extensions" }, () => service.updateAll());
        const handle = accessor.get(NotificationServiceDIToken).show(describeUpdateAllResult(result));
        // Not awaited: the command is done once the batch is, the notification may wait for an answer for long.
        void handle.answered.then((choice) => {
            // The page button's path: one reload command for everything (US-2.8).
            if (choice === 0) accessor.get(ExtensionPageActionsDIToken).reloadWindow();
        });
    },
};

export const ExtensionUpdateContributionDIToken = token<ExtensionUpdateContribution>("ExtensionUpdateContribution");

/** Before the catalog is read nothing is outdated, so `Update All` waits for the first viewlet show (US-2.9). */
export class ExtensionUpdateContribution extends Disposable implements IWorkbenchContribution {
    public static dependencies = [ExtensionsWorkbenchServiceDIToken, ContextKeyServiceDIToken] as const;

    public constructor(service: IExtensionsWorkbenchService, contextKeys: ContextKeyService) {
        super();
        const update = (): void => {
            contextKeys.set(HAS_OUTDATED_EXTENSIONS, service.getOutdated().length > 0);
        };
        update();
        this.register(service.onDidChange(update));
    }
}
