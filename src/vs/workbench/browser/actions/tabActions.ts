import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../platform/actions/common/menuId.ts";
import type { ServiceAccessor } from "../../../platform/instantiation/common/diContainer.ts";
import { parseChord, parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../platform/keybinding/common/keybindingResolver.ts";
import { ModifierReleaseArmoryDIToken } from "../../../platform/keybinding/common/modifierReleaseArmory.ts";
import { EditorGroupsServiceDIToken } from "../../services/editor/common/editorGroupsService.ts";
import { EditorServiceDIToken } from "../../services/editor/common/editorService.ts";

import { resolveTabTarget } from "./editorTabTarget.ts";
import { editorTabIsPreview, editorTabTargetArg } from "./menuContexts.ts";

/** Сильнее прокрутки строк редактора (upstream: WorkbenchContrib + 50; ступени хватает). */
const TAB_SWITCHER_WEIGHT = KeybindingWeight.WorkbenchContrib;

/**
 * Отпускание удерживающего модификатора фиксирует выбор: быстрые нажатия
 * тумблерят два последних редактора, удержание проходит вглубь. Из меню и
 * палитры модификатора нет — шаг без «hold-сессии».
 */
function cycleMruStep(accessor: ServiceAccessor, direction: 1 | -1): void {
    const groups = accessor.get(EditorGroupsServiceDIToken);
    groups.activeGroup.cycleMru(direction);
    accessor.get(ModifierReleaseArmoryDIToken).armOnHoldRelease(() => {
        groups.activeGroup.endMruCycle();
    });
}

/** У эталона команды вкладок стоят в `commandsToSkipShell` — в шелл терминала они не уходят. */
const EDITOR_TABS_FOCUS = "textViewFocus || terminalEditorFocus";

/**
 * Визуальный порядок, все группы, с заворотом; без hold-сессии. Alt-дубль — для
 * терминалов, где Ctrl+PgUp/PgDn заняты их собственными вкладками (gnome-terminal).
 */
export const nextEditorAction: CommandAction = {
    id: "workbench.action.nextEditor",
    title: "Open Next Editor",
    shortTitle: "Next Editor",
    menus: [{ menuId: MenuId.MenubarGoMenu, group: "2_editors", order: 1 }],
    keybinding: parseKeybinding("ctrl+pagedown"),
    keybindings: [parseKeybinding("alt+pagedown")],
    when: EDITOR_TABS_FOCUS,
    run(accessor) {
        accessor.get(EditorGroupsServiceDIToken).cycleEditor(1);
    },
};

export const previousEditorAction: CommandAction = {
    id: "workbench.action.previousEditor",
    title: "Open Previous Editor",
    shortTitle: "Previous Editor",
    menus: [{ menuId: MenuId.MenubarGoMenu, group: "2_editors", order: 2 }],
    keybinding: parseKeybinding("ctrl+pageup"),
    keybindings: [parseKeybinding("alt+pageup")],
    when: EDITOR_TABS_FOCUS,
    run(accessor) {
        accessor.get(EditorGroupsServiceDIToken).cycleEditor(-1);
    },
};

/**
 * Направление привязано к списку, а не к стороне, с которой серию начали.
 * Shift-варианты — для серии с Ctrl+Shift+Tab: модификатор часто остаётся зажатым.
 * Гейт разводит их с `scrollLineUp`/`scrollLineDown` на тех же Ctrl+Вверх/Вниз.
 */
const TAB_SWITCHER_ARROWS = "tabSwitcherVisible";

export const nextEditorInGroupAction: CommandAction = {
    id: "workbench.action.nextEditorInGroup",
    weight: TAB_SWITCHER_WEIGHT,
    title: "Next Editor In Group",
    shortTitle: "Next Used Editor",
    menus: [{ menuId: MenuId.MenubarGoMenu, group: "2_editors", order: 10 }],
    keybinding: parseKeybinding("ctrl+tab"),
    keybindings: [
        { keys: parseKeybinding("ctrl+down"), when: TAB_SWITCHER_ARROWS },
        { keys: parseKeybinding("ctrl+shift+down"), when: TAB_SWITCHER_ARROWS },
    ],
    when: "textViewFocus && editorTabsMultiple || terminalEditorFocus && editorTabsMultiple",
    run(accessor) {
        cycleMruStep(accessor, 1);
    },
};

export const previousEditorInGroupAction: CommandAction = {
    id: "workbench.action.previousEditorInGroup",
    weight: TAB_SWITCHER_WEIGHT,
    title: "Previous Editor In Group",
    shortTitle: "Previous Used Editor",
    menus: [{ menuId: MenuId.MenubarGoMenu, group: "2_editors", order: 20 }],
    keybinding: parseKeybinding("ctrl+shift+tab"),
    keybindings: [
        { keys: parseKeybinding("ctrl+up"), when: TAB_SWITCHER_ARROWS },
        { keys: parseKeybinding("ctrl+shift+up"), when: TAB_SWITCHER_ARROWS },
    ],
    when: "textViewFocus && editorTabsMultiple || terminalEditorFocus && editorTabsMultiple",
    run(accessor) {
        cycleMruStep(accessor, -1);
    },
};

/**
 * Без «hold-сессии»: об отпускании модификатора терминал сообщает только в
 * kitty-протоколе. Ctrl+6 (0x1e) доходит даже на legacy и совпадает с вимовским Ctrl+^.
 */
export const openPreviousRecentlyUsedEditorInGroupAction: CommandAction = {
    id: "workbench.action.openPreviousRecentlyUsedEditorInGroup",
    title: "Open Previous Recently Used Editor In Group",
    shortTitle: "Alternate Editor",
    menus: [{ menuId: MenuId.MenubarGoMenu, group: "2_editors", order: 15 }],
    keybinding: parseKeybinding("ctrl+6"),
    when: "textViewFocus && editorTabsMultiple",
    run(accessor) {
        const group = accessor.get(EditorGroupsServiceDIToken).activeGroup;
        group.cycleMru(1);
        group.endMruCycle();
    },
};

/**
 * Не гейтится «вкладка сейчас превью»: для приколотой это no-op, а иначе
 * Ctrl+K Enter на обычной вкладке проглатывался бы диспетчером впустую.
 */
export const keepEditorAction: CommandAction = {
    id: "workbench.action.keepEditor",
    title: "Keep Editor",
    shortTitle: "Keep Open",
    menus: [
        {
            menuId: MenuId.EditorTitleContext,
            group: "3_preview",
            order: 10,
            args: editorTabTargetArg,
            visible: editorTabIsPreview,
        },
    ],
    keybinding: parseChord("ctrl+k enter"),
    // Без гейта по фокусу: превью открывает Explorer, приколоть можно не уходя из него.
    when: "editorGroupHasEditors",
    run(accessor, ...args) {
        const target = resolveTabTarget(accessor.get(EditorGroupsServiceDIToken), args);
        // Индекс живой цели уже проверен резолвером — панель берём без защиты от `null`.
        if (target === null) return;
        target.group.pinPane(target.group.getPanes()[target.index]);
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
        // Из меню — вкладка ПОД КУРСОРОМ (правый клик её не активирует); иначе — активная.
        const target = resolveTabTarget(accessor.get(EditorGroupsServiceDIToken), args);
        if (target === null) return;

        // По адресу, а не focus-aware `getActiveEditor()`: при фокусе в панели тот вернул
        // бы Output (никогда не modified) — и изменённая вкладка закрылась бы молча.
        void service.closeEditor(target.group, target.index);
    },
};
