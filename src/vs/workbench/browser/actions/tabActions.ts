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

/** Стрелки по видимому списку tab-switcher сильнее прокрутки строк редактора (upstream: навигация пикера — WorkbenchContrib + 50; ступени хватает). */
const TAB_SWITCHER_WEIGHT = KeybindingWeight.WorkbenchContrib;

/**
 * Один шаг MRU-переключения вкладок. Каждое нажатие шагает по стеку, а отпускание
 * удерживающего модификатора (Ctrl для Ctrl+Tab, Alt для ребинда Alt+Tab и т.п.)
 * фиксирует выбор — так быстрые нажатия тумблерят два последних редактора, а
 * удержание проходит вглубь. Модификатор берётся из контекста текущего вызова
 * (см. ModifierReleaseArmory); из меню/палитры контекста нет — тогда шаг без
 * «hold-сессии».
 */
function cycleMruStep(accessor: ServiceAccessor, direction: 1 | -1): void {
    const groups = accessor.get(EditorGroupsServiceDIToken);
    groups.activeGroup.cycleMru(direction);
    accessor.get(ModifierReleaseArmoryDIToken).armOnHoldRelease(() => {
        groups.activeGroup.endMruCycle();
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
    when: "textViewFocus",
    run(accessor) {
        accessor.get(EditorGroupsServiceDIToken).cycleEditor(-1);
    },
};

/**
 * Стрелки внутри видимого списка серии: пока оверлей на экране, Вниз шагает тем
 * же шагом, что Tab, а Вверх — тем же, что Shift+Tab (направление привязано к
 * списку, а не к тому, с какой стороны серию начали). Shift-варианты — для серии,
 * начатой с Ctrl+Shift+Tab: модификатор там часто остаётся зажатым, и без них
 * первая же стрелка ушла бы мимо списка.
 *
 * Гейт `tabSwitcherVisible` разводит их с `scrollLineUp`/`scrollLineDown`, которые
 * сидят на тех же Ctrl+Вверх/Вниз: список погас — прокрутка вернулась; при
 * видимом списке побеждают эти — у них вес TAB_SWITCHER_WEIGHT.
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
    when: "textViewFocus && editorTabsMultiple",
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
        const group = accessor.get(EditorGroupsServiceDIToken).activeGroup;
        group.cycleMru(1);
        group.endMruCycle();
    },
};

/**
 * Прикалывает вкладку: она перестаёт быть предпросмотром и её больше не
 * замещает следующее превью (VS Code `workbench.action.keepEditor`, Ctrl+K Enter
 * и пункт «Keep Open» в меню вкладки). Для уже приколотой — no-op, поэтому
 * команда не гейтится «вкладка сейчас превью»: иначе Ctrl+K Enter на обычной
 * вкладке проглатывался бы диспетчером впустую.
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
    // Без гейта по фокусу: превью открывает дерево Explorer, и приколоть
    // вкладку должно быть можно не уходя из него.
    when: "editorGroupHasEditors",
    run(accessor, ...args) {
        const target = resolveTabTarget(accessor.get(EditorGroupsServiceDIToken), args);
        // Цели нет — вызов из палитры при пустой группе либо протухший адрес из
        // меню; делать нечего. У живой цели индекс уже проверен резолвером,
        // поэтому панель берём прямо, без защиты от `null`.
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
        // Из меню вкладки приходит адрес вкладки ПОД КУРСОРОМ (правый клик её не
        // активирует); с клавиатуры и из палитры аргументов нет — цель активная.
        const target = resolveTabTarget(accessor.get(EditorGroupsServiceDIToken), args);
        if (target === null) return;

        // Закрываем вкладку по её адресу, а не focus-aware `getActiveEditor()`:
        // при фокусе в панели тот вернул бы Output (он никогда не modified) — и
        // изменённая вкладка закрылась бы молча. Дифф v2 с несохранённой
        // стороной — тоже вкладка: confirm у него тот же, что у крестика мыши.
        void service.closeEditor(target.group, target.index);
    },
};
