import type { IDisposable } from "../../../../../tuidom/common/disposable.ts";
import type { MenuEntry, MenuSubmenuEntry } from "../../../../../tuidom/ui/menu/popupMenuElement.ts";
import type { CommandRegistry } from "../../commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../commands/common/commandRegistry.ts";
import type { ContextKeyService } from "../../contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../contextkey/common/contextKeyService.ts";
import { token } from "../../instantiation/common/diContainer.ts";
import type { KeybindingRegistry } from "../../keybinding/common/keybindingRegistry.ts";
import { formatKeybinding, KeybindingRegistryDIToken } from "../../keybinding/common/keybindingRegistry.ts";

import type { IMenuContribution, ISubmenuContribution, MenuContribution } from "./iMenuContribution.ts";
import { isSubmenuContribution, MenuContributionsDIToken } from "./iMenuContribution.ts";
import type { MenuId } from "./menuId.ts";

/** Резолвнутая submenu-запись (для меню-бара): label + мнемоника + вложенная точка. */
export interface ISubmenuEntry {
    readonly title: string;
    readonly mnemonic?: string;
    readonly submenu: MenuId;
    /** Submenu-выбор: рендерится выпадающим списком, а не вложенным попапом. */
    readonly isSelection?: boolean;
}

/** Отметка включённого пункта (VS Code рисует галочку у `toggled`-экшена). */
export const CHECKED_ICON = "\u2713"; // ✓

export const MenuRegistryDIToken = token<MenuRegistry>("MenuRegistry");

/**
 * Резолвер submenu-записи во вложенный `MenuSubmenuEntry` (для контекстных
 * меню). `null` — подменю выбрасывается (пустое или цикл `MenuId`).
 */
export type SubmenuResolver = (submenu: ISubmenuEntry) => MenuSubmenuEntry | null;

/**
 * Порядок групп: спец-группа `navigation` всегда первая (как в
 * `_compareMenuItems` VS Code), остальные — по строковому ключу. Ключи в
 * пределах одного меню уникальны, поэтому ветки равенства нет.
 */
function compareGroups(a: string, b: string): number {
    if (a === "navigation") return -1;
    if (b === "navigation") return 1;
    return a < b ? -1 : 1;
}

/**
 * Сгруппировать сохраняя порядок вставки, отсортировать группы (navigation →
 * строковый ключ) и пункты внутри по order (стабильно — по индексу вставки).
 */
function collectSorted<T extends { group?: string; order?: number }>(items: readonly T[]): T[][] {
    const groups = new Map<string, { item: T; index: number }[]>();
    items.forEach((item, index) => {
        const key = item.group ?? "";
        const bucket = groups.get(key);
        if (bucket) bucket.push({ item, index });
        else groups.set(key, [{ item, index }]);
    });
    return [...groups.keys()].sort(compareGroups).map((key) => {
        const bucket = groups.get(key)!;
        bucket.sort((a, b) => (a.item.order ?? 0) - (b.item.order ?? 0) || a.index - b.index);
        return bucket.map((entry) => entry.item);
    });
}

/**
 * Реестр declarative menu-contributions (аналог `MenuRegistry` VS Code): по
 * `menuId` фильтрует пункты (`when` + `visible`), сортирует по group/order,
 * вставляет разделители между непустыми группами и резолвит в `MenuEntry`
 * (label из title команды / явного, шорткат из `KeybindingRegistry`, args и
 * `onSelect → CommandRegistry.execute`). Чистая функция реестров команд/
 * кейбиндов/контекст-ключей — состояние открытия (напр. буфер обмена) приходит
 * параметром `context`, не через DI.
 */
export class MenuRegistry {
    public static dependencies = [
        CommandRegistryDIToken,
        KeybindingRegistryDIToken,
        ContextKeyServiceDIToken,
        MenuContributionsDIToken,
    ] as const;

    private readonly items: MenuContribution[];
    private readonly changeListeners = new Set<(menuId: MenuId) => void>();

    public constructor(
        private readonly commands: CommandRegistry,
        private readonly keybindings: KeybindingRegistry,
        private readonly contextKeys: ContextKeyService,
        contributions: readonly MenuContribution[],
    ) {
        this.items = [...contributions];
    }

    /** Динамически добавить пункт (напр. из расширения); dispose снимает его. */
    public appendMenuItem(item: MenuContribution): IDisposable {
        this.items.push(item);
        this.fireDidChangeMenu(item.menuId);
        return {
            dispose: () => {
                const index = this.items.indexOf(item);
                if (index >= 0) {
                    this.items.splice(index, 1);
                    this.fireDidChangeMenu(item.menuId);
                }
            },
        };
    }

    /**
     * Подписка на изменение состава меню (аналог `onDidChangeMenu` VS Code):
     * срабатывает при `appendMenuItem` и снятии пункта. Живой пересбор по
     * событию — забота консюмера (`IMenu` в `MenuService`).
     */
    public onDidChangeMenu(listener: (menuId: MenuId) => void): IDisposable {
        this.changeListeners.add(listener);
        return { dispose: () => this.changeListeners.delete(listener) };
    }

    private fireDidChangeMenu(menuId: MenuId): void {
        for (const listener of [...this.changeListeners]) {
            listener(menuId);
        }
    }

    public getMenuItems(menuId: MenuId, context?: unknown, resolveSubmenu?: SubmenuResolver): MenuEntry[] {
        const visible = this.items.filter((item) => {
            if (item.menuId !== menuId) return false;
            // Без резолвера submenu-записи в обычных меню не рендерим — их
            // потребляет только `getSubmenus` (меню-бар). С резолвером они
            // встраиваются вложенными попапами со своим group/order-слотом.
            if (isSubmenuContribution(item)) {
                if (resolveSubmenu === undefined) return false;
                if (item.when !== undefined && !this.contextKeys.evaluate(item.when)) return false;
                // Императивная видимость по контексту открытия — как у пунктов:
                // подменю секции сайдбара фильтруются по `menuContext.view`
                // (when-ключ не годится — в сайдбаре видно несколько секций).
                if (item.visible !== undefined && !item.visible(context)) return false;
                return true;
            }
            if (item.when !== undefined && !this.contextKeys.evaluate(item.when)) return false;
            if (item.visible !== undefined && !item.visible(context)) return false;
            return true;
        });

        const result: MenuEntry[] = [];
        for (const bucket of collectSorted(visible)) {
            const groupEntries: MenuEntry[] = [];
            for (const item of bucket) {
                if (isSubmenuContribution(item)) {
                    // null от резолвера — подменю выброшено (пустое/цикл).
                    const entry = resolveSubmenu!(this.toSubmenuEntry(item));
                    if (entry !== null) groupEntries.push(entry);
                } else {
                    groupEntries.push(this.toEntry(item, context));
                }
            }
            if (groupEntries.length === 0) continue;
            // Разделитель — только между непустыми группами (без ведущих/хвостовых).
            if (result.length > 0) result.push({ type: "separator" });
            result.push(...groupEntries);
        }
        return result;
    }

    /**
     * Submenu-записи меню (тот же when-фильтр и group/order-сортировка, но без
     * разделителей): из них меню-бар строит свои top-уровневые пункты.
     */
    public getSubmenus(menuId: MenuId): ISubmenuEntry[] {
        const visible = this.items.filter((item): item is ISubmenuContribution => {
            if (item.menuId !== menuId) return false;
            if (!isSubmenuContribution(item)) return false;
            if (item.when !== undefined && !this.contextKeys.evaluate(item.when)) return false;
            return true;
        });
        return collectSorted(visible)
            .flat()
            .map((item) => this.toSubmenuEntry(item));
    }

    private toSubmenuEntry(item: ISubmenuContribution): ISubmenuEntry {
        return {
            title: item.title,
            mnemonic: item.mnemonic,
            submenu: item.submenu,
            isSelection: item.isSelection,
        };
    }

    private toEntry(item: IMenuContribution, context: unknown): MenuEntry {
        const label = item.title ?? this.commands.getTitle(item.command) ?? item.command;
        const resolvedArgs = item.args ? item.args(context) : [];
        return {
            label,
            shortcut: this.resolveShortcut(item),
            // `toggled` рисуется отметкой в колонке иконки — так VS Code помечает
            // включённый пункт (например текущий канал Output).
            icon: item.toggled !== undefined && this.contextKeys.evaluate(item.toggled) ? CHECKED_ICON : item.icon,
            onSelect: () => {
                this.commands.execute(item.command, ...resolvedArgs);
            },
        };
    }

    private resolveShortcut(item: IMenuContribution): string | undefined {
        if (item.shortcut === false) return undefined;
        if (typeof item.shortcut === "string") return item.shortcut;
        const chord = this.keybindings.getKeybindingForCommand(item.command, this.contextKeys);
        return chord ? formatKeybinding(chord) : undefined;
    }
}
