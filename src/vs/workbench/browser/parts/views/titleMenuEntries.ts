import type { MenuEntry } from "@tuidom/elements/menu/popupMenuElement";

import type {
    IMenuEntryGroup,
    IResolvedMenuItemEntry,
    ResolvedMenuEntry,
} from "../../../../platform/actions/common/menuRegistry.ts";
import { joinMenuGroups } from "../../../../platform/actions/common/menuRegistry.ts";

import type { IViewTitleAction } from "./viewTitleRowElement.ts";

export const NAVIGATION_GROUP = "navigation";

/**
 * Пункт `navigation` без иконки остаётся в «⋯»: подпись в 30 колонок сайдбара не влезет.
 * Submenu-записи — тоже, кроме submenu-выбора (см. {@link overflowEntries}).
 */
export function inlineActions(groups: readonly IMenuEntryGroup[]): IViewTitleAction[] {
    const navigation = groups.find((group) => group.group === NAVIGATION_GROUP);
    if (navigation === undefined) return [];
    return navigation.entries
        .filter(isInlineItem)
        .map((entry) => ({ id: entry.id, icon: entry.icon, enabled: entry.enabled }));
}

/**
 * Submenu-выбор группы `navigation` (`isSelection`) владелец view рисует сам выпадающим
 * списком, как VS Code — `SelectBox`'ом тулбара; пункт «⋯» дублировал бы этот список.
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

export function runAction(groups: readonly IMenuEntryGroup[], actionId: string): void {
    for (const group of groups) {
        for (const entry of group.entries) {
            if (isInlineItem(entry) && entry.id === actionId) {
                // Погашенная кнопка кликается (иначе клик свернул бы секцию), но ничего не делает:
                // отказ живёт в самом резолвнутом пункте (`MenuRegistry.toEntry`).
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
