import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../platform/actions/common/menuId.ts";
import { parseChord, parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../platform/keybinding/common/keybindingResolver.ts";
import { HistoryServiceDIToken } from "../../services/history/browser/historyService.ts";

/**
 /**
  * Не VS Code'шная `1_history_nav`: группы сортируются строкой, и
  * `"1_goto" < "1_history_nav"` увёл бы переходы под «Go to File».
  */
const HISTORY_GROUP = "0_history_nav";

/**
 * Канонический бинд — только где терминал его передаёт (на legacy Ctrl+Alt+-
 * неотличим от Alt+-); рабочий путь везде — Ctrl+K Ctrl+B.
 *
 * Вторая часть аккорда — с модификатором: парный keypress закреплён за целью
 * своего keydown (`TuiApplication.pinnedKeypressTarget`), а команда переключает
 * вкладку — цель уезжает из дерева, и голый символ напечатался бы в покинутый документ.
 *
 * `when` нет намеренно: без истории — no-op, как в VS Code; заодно без
 * focus-scoped ключа шаг корректно подавляется модальным оверлеем.
 */
export const navigateBackAction: CommandAction = {
    id: "workbench.action.navigateBack",
    title: "Go Back",
    shortTitle: "Back",
    menus: [{ menuId: MenuId.MenubarGoMenu, group: HISTORY_GROUP, order: 10, when: "canNavigateBack" }],
    keybinding: parseChord("ctrl+k ctrl+b"),
    keybindings: [{ keys: parseKeybinding("ctrl+alt+-"), when: "tier != 'legacy'" }],
    run(accessor) {
        accessor.get(HistoryServiceDIToken).goBack();
    },
};

export const navigateForwardAction: CommandAction = {
    id: "workbench.action.navigateForward",
    // Чорд Ctrl+K Ctrl+F делит с pc-биндом `editor.action.formatSelection` и сейчас его перебивает (так было и при порядке регистрации; коллизия записана в docs/arch/workbench/Commands.md#коллизии-дефолтов). Вес держит это поведение, пока коллизию не развели.
    weight: KeybindingWeight.WorkbenchContrib,
    title: "Go Forward",
    shortTitle: "Forward",
    menus: [{ menuId: MenuId.MenubarGoMenu, group: HISTORY_GROUP, order: 20, when: "canNavigateForward" }],
    keybinding: parseChord("ctrl+k ctrl+f"),
    keybindings: [{ keys: parseKeybinding("ctrl+shift+-"), when: "tier != 'legacy'" }],
    run(accessor) {
        accessor.get(HistoryServiceDIToken).goForward();
    },
};
