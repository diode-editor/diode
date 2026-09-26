import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../platform/actions/common/menuId.ts";
import type { ServiceAccessor } from "../../../platform/instantiation/common/diContainer.ts";
import { parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { ModifierReleaseArmoryDIToken } from "../../../platform/keybinding/common/modifierReleaseArmory.ts";
import { EditorServiceDIToken } from "../../services/editor/browser/editorService.ts";

import { resolveTabTarget } from "./editorTabTarget.ts";
import { editorTabTargetArg } from "./menuContexts.ts";

/**
 * Один шаг MRU-переключения вкладок. Каждое нажатие шагает по стеку, а отпускание
 * удерживающего модификатора (Ctrl для Ctrl+Tab, Alt для ребинда Alt+Tab и т.п.)
 * фиксирует выбор — так быстрые нажатия тумблерят два последних редактора, а
 * удержание проходит вглубь. Модификатор берётся из контекста текущего вызова
 * (см. ModifierReleaseArmory); из меню/палитры контекста нет — тогда шаг без
 * «hold-сессии».
 */
function cycleMruStep(accessor: ServiceAccessor, direction: 1 | -1): void {
    const group = accessor.get(EditorServiceDIToken);
    group.cycleMru(direction);
    accessor.get(ModifierReleaseArmoryDIToken).armOnHoldRelease(() => {
        group.endMruCycle();
    });
}

/**
 * Шаг по вкладкам в ВИЗУАЛЬНОМ порядке (VS Code `nextEditor`/`previousEditor`,
 * Ctrl+PgDn/PgUp): все группы слева направо, с заворотом. Без hold-сессии —
 * каждый шаг сразу коммитится; за MRU-переключение отвечает пара Ctrl+Tab
 * ({@link nextEditorInGroupAction}). Alt-дубль — для терминалов, где
 * Ctrl+PgUp/PgDn заняты их собственными вкладками (gnome-terminal и т.п.).
 */
export const nextEditorAction: CommandAction = {
    id: "workbench.action.nextEditor",
    title: "Open Next Editor",
    shortTitle: "Next Editor",
    menus: [{ menuId: MenuId.MenubarGoMenu, group: "2_editors", order: 1 }],
    keybinding: parseKeybinding("ctrl+pagedown"),
    keybindings: [parseKeybinding("alt+pagedown")],
    when: "textViewFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).cycleEditor(1);
    },
};

export const previousEditorAction: CommandAction = {
    id: "workbench.action.previousEditor",
    title: "Open Previous Editor",
    shortTitle: "Previous Editor",
    menus: [{ menuId: MenuId.MenubarGoMenu, group: "2_editors", order: 2 }],
    keybinding: parseKeybinding("ctrl+pageup"),
    keybindings: [parseKeybinding("alt+pageup")],
    when: "textViewFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).cycleEditor(-1);
    },
};

export const nextEditorInGroupAction: CommandAction = {
    id: "workbench.action.nextEditorInGroup",
    title: "Next Editor In Group",
    shortTitle: "Next Used Editor",
    menus: [{ menuId: MenuId.MenubarGoMenu, group: "2_editors", order: 10 }],
    keybinding: parseKeybinding("ctrl+tab"),
    when: "textViewFocus && editorTabsMultiple",
    run(accessor) {
        cycleMruStep(accessor, 1);
    },
};

export const previousEditorInGroupAction: CommandAction = {
    id: "workbench.action.previousEditorInGroup",
    title: "Previous Editor In Group",
    shortTitle: "Previous Used Editor",
    menus: [{ menuId: MenuId.MenubarGoMenu, group: "2_editors", order: 20 }],
    keybinding: parseKeybinding("ctrl+shift+tab"),
    when: "textViewFocus && editorTabsMultiple",
    run(accessor) {
        cycleMruStep(accessor, -1);
    },
};

/**
 * Тумблер двух последних редакторов (VS Code `openPreviousRecentlyUsedEditorInGroup`,
 * у него без дефолтного бинда). Шаг по MRU с немедленной фиксацией — в отличие от
 * Ctrl+Tab здесь нет «hold-сессии»: терминал сообщает об отпускании модификатора
 * только в kitty-протоколе, а Ctrl+6 задуман как работающий везде. Комбинация
 * выбрана под терминал: 0x1e доходит даже на legacy, где Ctrl+Tab неотличим от Tab,
 * и совпадает с вимовским Ctrl+^ («alternate file»).
 */
export const openPreviousRecentlyUsedEditorInGroupAction: CommandAction = {
    id: "workbench.action.openPreviousRecentlyUsedEditorInGroup",
    title: "Open Previous Recently Used Editor In Group",
    shortTitle: "Alternate Editor",
    menus: [{ menuId: MenuId.MenubarGoMenu, group: "2_editors", order: 15 }],
    keybinding: parseKeybinding("ctrl+6"),
    when: "textViewFocus && editorTabsMultiple",
    run(accessor) {
        const group = accessor.get(EditorServiceDIToken);
        group.cycleMru(1);
        group.endMruCycle();
    },
};

export const closeActiveEditorAction: CommandAction = {
    id: "workbench.action.closeActiveEditor",
    title: "Close Active Editor",
    shortTitle: "Close",
    menus: [
        { menuId: MenuId.MenubarFileMenu, group: "5_close", order: 10, title: "Close Editor" },
        { menuId: MenuId.EditorTitleContext, group: "1_close", order: 10, args: editorTabTargetArg },
    ],
    keybinding: parseKeybinding("mod+w"),
    when: "textViewFocus && editorGroupHasEditors",
    run(accessor, ...args) {
        const service = accessor.get(EditorServiceDIToken);
        // Из меню вкладки приходит адрес вкладки ПОД КУРСОРОМ (правый клик её не
        // активирует); с клавиатуры и из палитры аргументов нет — цель активная.
        const target = resolveTabTarget(service, args);
        if (target === null) return;

        // Закрываем вкладку по её индексу, поэтому и dirty спрашиваем у НЕЁ:
        // focus-aware `getActiveEditor()` при фокусе в панели вернул бы Output
        // (он никогда не modified) — и изменённая вкладка закрылась бы молча.
        // Именно getPane: дифф v2 с несохранённой стороной — тоже вкладка, и
        // Ctrl+W обязан спрашивать про неё так же, как крестик мыши.
        const pane = target.group.getPane(target.index);
        if (pane !== null && service.needsCloseConfirm(pane) && service.onRequestConfirmClose) {
            service.onRequestConfirmClose(target.group, target.index);
        } else {
            target.group.closeTab(target.index);
        }
    },
};
