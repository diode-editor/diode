import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../platform/actions/common/menuId.ts";
import type { ServiceAccessor } from "../../../platform/instantiation/common/diContainer.ts";
import { token } from "../../../platform/instantiation/common/diContainer.ts";
import { parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { DialogServiceDIToken } from "../../services/dialogs/browser/dialogService.ts";
import { LifecycleServiceDIToken } from "../../services/lifecycle/browser/lifecycleService.ts";
import { WindowReloadHandlerDIToken } from "../../services/lifecycle/common/windowReload.ts";

/**
 * Выход из приложения. Интерфейсный шов: Workbench объявляет, владелец приложения
 * (`WorkbenchComponent`: confirm-save через LifecycleService, затем teardown TUI +
 * exit) соответствует структурно; биндинг — в `Workbench/Modules/WorkbenchModule.ts`.
 */
export interface IQuitHandler {
    requestQuit(accessor: ServiceAccessor): void;
}

export const QuitHandlerDIToken = token<IQuitHandler>("QuitHandler");

export const quitAction: CommandAction = {
    id: "workbench.action.quit",
    title: "Quit",
    // Label только в меню — vscode-паттерн per-menu title override.
    menus: [{ menuId: MenuId.MenubarFileMenu, title: "Exit", group: "5_quit", order: 10 }],
    keybinding: parseKeybinding("ctrl+q"),
    run(accessor) {
        accessor.get(QuitHandlerDIToken).requestQuit(accessor);
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
        const reload = accessor.get(WindowReloadHandlerDIToken);
        void accessor.get(LifecycleServiceDIToken).requestShutdown(() => {
            reload.reloadWindow();
        });
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
