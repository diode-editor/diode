import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../platform/actions/common/menuId.ts";
import type { ServiceAccessor } from "../../../platform/instantiation/common/diContainer.ts";
import { parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { ModifierReleaseArmoryDIToken } from "../../../platform/keybinding/common/modifierReleaseArmory.ts";
import { EditorServiceDIToken } from "../../services/editor/browser/editorService.ts";

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

export const nextEditorInGroupAction: CommandAction = {
    id: "workbench.action.nextEditorInGroup",
    title: "Next Editor In Group",
    shortTitle: "Next Editor",
    menus: [{ menuId: MenuId.MenubarGoMenu, group: "2_editors", order: 10 }],
    keybinding: parseKeybinding("ctrl+tab"),
    keybindings: [parseKeybinding("ctrl+pagedown"), parseKeybinding("alt+pagedown")],
    when: "textViewFocus && editorTabsMultiple",
    run(accessor) {
        cycleMruStep(accessor, 1);
    },
};

export const previousEditorInGroupAction: CommandAction = {
    id: "workbench.action.previousEditorInGroup",
    title: "Previous Editor In Group",
    shortTitle: "Previous Editor",
    menus: [{ menuId: MenuId.MenubarGoMenu, group: "2_editors", order: 20 }],
    keybinding: parseKeybinding("ctrl+shift+tab"),
    keybindings: [parseKeybinding("ctrl+pageup"), parseKeybinding("alt+pageup")],
    when: "textViewFocus && editorTabsMultiple",
    run(accessor) {
        cycleMruStep(accessor, -1);
    },
};

export const closeActiveEditorAction: CommandAction = {
    id: "workbench.action.closeActiveEditor",
    title: "Close Active Editor",
    shortTitle: "Close Editor",
    menus: [{ menuId: MenuId.MenubarFileMenu, group: "5_close", order: 10 }],
    keybinding: parseKeybinding("ctrl+w"),
    when: "textViewFocus && editorGroupHasEditors",
    run(accessor) {
        const group = accessor.get(EditorServiceDIToken);
        if (group.editorCount === 0 || group.activeIndex < 0) return;

        // Закрываем вкладку по `activeIndex`, поэтому и dirty спрашиваем у НЕЁ:
        // focus-aware `getActiveEditor()` при фокусе в панели вернул бы Output
        // (он никогда не modified) — и изменённая вкладка закрылась бы молча.
        const editor = group.getEditor(group.activeIndex);
        if (editor?.isModified && group.onRequestConfirmClose) {
            group.onRequestConfirmClose(group.activeIndex);
        } else {
            group.closeTab(group.activeIndex);
        }
    },
};
