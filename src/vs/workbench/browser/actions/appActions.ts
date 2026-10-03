import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../platform/actions/common/menuId.ts";
import type { ServiceAccessor } from "../../../platform/instantiation/common/diContainer.ts";
import { parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { DialogServiceDIToken } from "../../services/dialogs/browser/dialogService.ts";
import type { ShutdownReason } from "../../services/lifecycle/browser/lifecycleService.ts";
import { LifecycleServiceDIToken } from "../../services/lifecycle/browser/lifecycleService.ts";
import { HostProcessDIToken } from "../../services/lifecycle/common/hostProcess.ts";

/**
 * Общий путь выхода и перезагрузки: confirm-save (`requestShutdown`), затем
 * единое прощание участников (`shutdown`), затем процесс-владелец — выход или
 * замена процесса новым. Cancel в диалоге оставляет окно на месте.
 */
function closeWindow(accessor: ServiceAccessor, reason: Extract<ShutdownReason, "quit" | "reload">): Promise<void> {
    const lifecycle = accessor.get(LifecycleServiceDIToken);
    const host = accessor.get(HostProcessDIToken);
    return lifecycle.requestShutdown(() =>
        lifecycle.shutdown(reason, () => {
            if (reason === "quit") host.exit();
            else host.restart();
        }),
    );
}

export const quitAction: CommandAction = {
    id: "workbench.action.quit",
    title: "Quit",
    // Label только в меню — vscode-паттерн per-menu title override.
    menus: [{ menuId: MenuId.MenubarFileMenu, title: "Exit", group: "5_quit", order: 10 }],
    keybinding: parseKeybinding("mod+q"),
    run(accessor) {
        return closeWindow(accessor, "quit");
    },
};

/**
 * Перезагрузка окна: процесс поднимается заново с теми же аргументами, сессия
 * восстанавливается из сохранённого состояния. Это наш ответ на «расширение
 * установлено, но ещё не работает» — вклады сканируются один раз на старте,
 * горячей активации нет (docs/TODO/Extensions.md, Phase 7).
 *
 * Прощание — тот же протокол, что у выхода: несохранённые вкладки спрашиваются
 * через `LifecycleService`, Cancel оставляет окно на месте. Дефолтного бинда
 * нет: перезагрузка — не ежеминутное действие, а `ctrl+r` бережём под Open Recent.
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
