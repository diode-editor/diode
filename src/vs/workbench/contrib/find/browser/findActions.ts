import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../../platform/keybinding/common/keybindingResolver.ts";

import { FindServiceDIToken } from "./findService.ts";

/** Вес find-виджета (upstream: EditorContrib + 5): Escape и Enter виджета сильнее базовых команд редактора, но слабее попапов над текстом — inline, suggest, hover и подсказки параметров. */
const FIND_WEIGHT = KeybindingWeight.EditorContrib;

// Тонкие экшены find-виджета поверх FindService (этап 10: run-обработчики живут
// в самих экшенах, как у quick-open). Биндинги `findWidgetVisible` перебивают
// editor-команды на тех же клавишах весом FIND_WEIGHT.

export const findAction: CommandAction = {
    id: "actions.find",
    title: "Find",
    menus: [{ menuId: MenuId.MenubarEditMenu, group: "3_find", order: 10 }],
    keybinding: parseKeybinding("mod+f"),
    // Reachable from the editor, and while the widget is open (to refocus the input).
    when: "textInputFocus || findWidgetVisible",
    run(accessor) {
        accessor.get(FindServiceDIToken).open();
    },
};

export const nextMatchAction: CommandAction = {
    id: "editor.action.nextMatchFindAction",
    weight: FIND_WEIGHT,
    title: "Find: Next Match",
    shortTitle: "Find Next",
    menus: [{ menuId: MenuId.MenubarEditMenu, group: "3_find", order: 20 }],
    // F3 — от фокуса в тексте, как `EditorContextKeys.focus` у upstream: поиск
    // продолжается по последнему запросу и с закрытым виджетом. Enter остаётся
    // привязанным к открытому виджету — в тексте он печатает перевод строки.
    keybindings: [
        { keys: parseKeybinding("enter"), when: "findWidgetVisible" },
        { keys: parseKeybinding("f3"), when: "textInputFocus || findWidgetVisible" },
    ],
    run(accessor) {
        accessor.get(FindServiceDIToken).next();
    },
};

export const previousMatchAction: CommandAction = {
    id: "editor.action.previousMatchFindAction",
    title: "Find: Previous Match",
    shortTitle: "Find Previous",
    menus: [{ menuId: MenuId.MenubarEditMenu, group: "3_find", order: 30 }],
    keybindings: [
        { keys: parseKeybinding("shift+enter"), when: "findWidgetVisible" },
        { keys: parseKeybinding("shift+f3"), when: "textInputFocus || findWidgetVisible" },
    ],
    run(accessor) {
        accessor.get(FindServiceDIToken).prev();
    },
};

export const closeFindWidgetAction: CommandAction = {
    id: "closeFindWidget",
    weight: FIND_WEIGHT,
    title: "Find: Close",
    keybinding: parseKeybinding("escape"),
    when: "findWidgetVisible",
    run(accessor) {
        accessor.get(FindServiceDIToken).close();
    },
};

/** Экшены find-виджета. Фича отдаёт их одним массивом; регистрирует агрегатор (`builtinActions`). */
export const FIND_ACTIONS: readonly CommandAction[] = [
    findAction,
    nextMatchAction,
    previousMatchAction,
    closeFindWidgetAction,
];
