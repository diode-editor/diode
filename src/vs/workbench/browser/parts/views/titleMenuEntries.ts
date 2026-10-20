import type { MenuEntry } from "@tuidom/elements/menu/popupMenuElement";

import type {
    IMenuEntryGroup,
    IResolvedMenuItemEntry,
    ResolvedMenuEntry,
} from "../../../../platform/actions/common/menuRegistry.ts";
import { joinMenuGroups } from "../../../../platform/actions/common/menuRegistry.ts";

import type { IViewTitleAction } from "./viewTitleRowElement.ts";

// Разбор резолвнутого меню заголовка на inline-кнопки и попап «⋯» — общий у
// заголовков view/контейнеров (`ViewsService`) и полосы вкладок группы
// редакторов (`MenuId.EditorTitle`): правило «кнопкой — пункт `navigation` с
// иконкой» у них одно, как у тулбаров эталона.

/** Спец-группа VS Code: её пункты рисуются кнопками в заголовке, а не в попапе. */
export const NAVIGATION_GROUP = "navigation";

/**
 * Inline-кнопки заголовка: группа `navigation`, у пунктов которой есть иконка.
 * Пункт без иконки кнопкой не нарисовать (в 30 колонок сайдбара не влезет
 * подпись), поэтому он остаётся в «⋯» — как и submenu-записи навигации
 * (кроме submenu-выбора: оно — виджет заголовка, см. {@link overflowEntries}).
 */
export function inlineActions(groups: readonly IMenuEntryGroup[]): IViewTitleAction[] {
    const navigation = groups.find((group) => group.group === NAVIGATION_GROUP);
    if (navigation === undefined) return [];
    return navigation.entries
        .filter(isInlineItem)
        .map((entry) => ({ id: entry.id, icon: entry.icon, enabled: entry.enabled }));
}

/**
 * Пункты попапа «⋯»: всё, что не уехало в inline-кнопки и в виджет заголовка.
 * Submenu-выбор группы `navigation` (`isSelection`) владелец view рисует сам
 * выпадающим списком (`setViewTitleWidget`, селектор каналов Output) — как
 * VS Code рисует его `SelectBox`'ом тулбара. Повторять его пунктом «⋯» значит
 * показать рядом два одинаковых списка, а у вкладки — кнопку, которая только
 * этот дубль и открывает.
 */
export function overflowEntries(groups: readonly IMenuEntryGroup[]): MenuEntry[] {
    const rest = groups.map((group) =>
        group.group === NAVIGATION_GROUP
            ? {
                  group: group.group,
                  entries: group.entries.filter((entry) => !isInlineItem(entry) && !isSelectionSubmenu(entry)),
              }
            : group,
    );
    return joinMenuGroups(rest.filter((group) => group.entries.length > 0));
}

/** Клик по inline-кнопке исполняет тот же пункт, что нарисовал кнопку. */
export function runAction(groups: readonly IMenuEntryGroup[], actionId: string): void {
    for (const group of groups) {
        for (const entry of group.entries) {
            if (isInlineItem(entry) && entry.id === actionId) {
                // Погашенная кнопка кликается (зона за ней осталась, иначе клик
                // свернул бы секцию), но ничего не делает: отказ живёт в самом
                // резолвнутом пункте (`MenuRegistry.toEntry`), второй проверки
                // здесь не нужно.
                // Stryker disable next-line OptionalChaining: onSelect есть у любого пункта, резолвнутого MenuRegistry — защита от чужих реализаций MenuEntry
                entry.onSelect?.();
                return;
            }
        }
    }
}

export function isSelectionSubmenu(entry: ResolvedMenuEntry): boolean {
    // Stryker disable next-line ConditionalExpression: проверка типа — сужение для TS; пометку `isSelection` реестр ставит только submenu-записям, у пункта-команды её не бывает
    return entry.type === "submenu" && entry.isSelection === true;
}

export function isInlineItem(entry: ResolvedMenuEntry): entry is IResolvedMenuItemEntry & { id: string; icon: string } {
    // Stryker disable next-line ConditionalExpression,LogicalOperator: проверка типа — сужение для TS; у подменю и разделителя нет `id`, их отсекает следующая проверка
    if (entry.type !== undefined) return false;
    return typeof entry.id === "string" && typeof entry.icon === "string";
}
