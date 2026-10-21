import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../platform/actions/common/menuId.ts";
import type { ServiceAccessor } from "../../../platform/instantiation/common/diContainer.ts";
import { parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { DialogServiceDIToken } from "../../services/dialogs/browser/dialogService.ts";
import type { ShutdownReason } from "../../services/lifecycle/browser/lifecycleService.ts";
import { LifecycleServiceDIToken } from "../../services/lifecycle/browser/lifecycleService.ts";
import { HostProcessDIToken, type IRelaunchRequest } from "../../services/lifecycle/common/hostProcess.ts";

/** Cancel in the confirm-save dialog keeps the window open. */
function closeWindow(
    accessor: ServiceAccessor,
    reason: Extract<ShutdownReason, "quit" | "reload">,
    relaunch?: IRelaunchRequest,
): Promise<void> {
    const lifecycle = accessor.get(LifecycleServiceDIToken);
    const host = accessor.get(HostProcessDIToken);
    return lifecycle.requestShutdown(() =>
        lifecycle.shutdown(reason, () => {
            if (reason === "quit") host.exit();
            else host.restart(relaunch);
        }),
    );
}

/** Can also request a different profile or workspace for the next window. */
export function reloadWindow(accessor: ServiceAccessor, relaunch?: IRelaunchRequest): Promise<void> {
    // Stryker disable next-line StringLiteral: a ShutdownReason literal; any non-quit value leads to restart
    return closeWindow(accessor, "reload", relaunch);
}

export const quitAction: CommandAction = {
    id: "workbench.action.quit",
    title: "Quit",
    menus: [{ menuId: MenuId.MenubarFileMenu, title: "Exit", group: "5_quit", order: 10 }],
    keybinding: parseKeybinding("mod+q"),
    run(accessor) {
        return closeWindow(accessor, "quit");
    },
};

/**
 * Answers "the extension is installed but doesn't work yet": there is no hot activation
 * (docs/TODO/Extensions.md, Phase 7). No default binding: `ctrl+r` is reserved for Open Recent.
 */
export const reloadWindowAction: CommandAction = {
    id: "workbench.action.reloadWindow",
    title: "Reload Window",
    menus: [{ menuId: MenuId.MenubarFileMenu, group: "5_quit", order: 5 }],
    run(accessor) {
        return closeWindow(accessor, "reload");
    },
};

export const showAboutDialogAction: CommandAction = {
    id: "workbench.action.showAboutDialog",
    title: "About",
    menus: [{ menuId: MenuId.MenubarHelpMenu, group: "1_about", order: 10 }],
    run(accessor) {
        accessor.get(DialogServiceDIToken).showAboutDialog();
    },
};
