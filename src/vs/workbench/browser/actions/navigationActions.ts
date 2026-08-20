import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../platform/actions/common/menuId.ts";
import { parseChord, parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { HistoryServiceDIToken } from "../../services/history/browser/historyService.ts";

/**
 * Группа Back/Forward в меню Go. Не VS Code'шная `1_history_nav`: группы
 * сортируются строкой, а в этом меню уже живут `1_goto` и `2_editors` —
 * `"1_goto" < "1_history_nav"`, и переходы уехали бы под «Go to File».
 */
const HISTORY_GROUP = "0_history_nav";

/**
 * Шаг назад по истории навигации (VS Code `workbench.action.navigateBack`).
 *
 * Канонический бинд VS Code объявлен только там, где терминал способен его
 * передать: на legacy Ctrl+Alt+- приезжает неотличимым от Alt+-. Рабочий путь
 * везде — leader-аккорд Ctrl+K Ctrl+B (паттерн `showSearchAction`/
 * `showCommandsAction`).
 *
 * Почему вторая часть аккорда С модификатором, а не голая клавиша: парный
 * keypress закреплён за целью своего keydown (`TuiApplication.pinnedKeypressTarget`),
 * и когда команда переключает вкладку, эта цель уезжает из дерева — глобальный
 * capture-обработчик `KeybindingDispatcher` до неё уже не достаёт и проглотить
 * клавишу не может. Голый символ в этот момент печатается в документ, который мы
 * только что покинули; клавиша с Ctrl отбрасывается редактором сама.
 *
 * Action-wide `when` нет намеренно: команда без истории — no-op, как в VS Code,
 * где `canNavigateBack` гейтит только пункт меню. Побочный эффект того же
 * решения полезен: без focus-scoped ключа в `when` шаг по истории не считается
 * командой сфокусированного виджета (`KeybindingDispatcher`), и пока клавиатурой
 * владеет модальный оверлей, он корректно подавляется.
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

/** Шаг вперёд по истории навигации (VS Code `workbench.action.navigateForward`). */
export const navigateForwardAction: CommandAction = {
    id: "workbench.action.navigateForward",
    title: "Go Forward",
    shortTitle: "Forward",
    menus: [{ menuId: MenuId.MenubarGoMenu, group: HISTORY_GROUP, order: 20, when: "canNavigateForward" }],
    keybinding: parseChord("ctrl+k ctrl+f"),
    keybindings: [{ keys: parseKeybinding("ctrl+shift+-"), when: "tier != 'legacy'" }],
    run(accessor) {
        accessor.get(HistoryServiceDIToken).goForward();
    },
};
