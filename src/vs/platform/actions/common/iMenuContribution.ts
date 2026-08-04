import { token } from "../../instantiation/common/diContainer.ts";

import type { MenuId } from "./menuId.ts";

/**
 * Декларативная запись пункта меню (аналог вклада в `MenuRegistry` VS Code).
 * Пункты собираются в явный массив `MENU_CONTRIBUTIONS` (зеркало `builtinActions`)
 * и резолвятся `MenuRegistry.getMenuItems` в конкретный `MenuEntry`.
 */
export interface IMenuContribution {
    readonly menuId: MenuId;
    /** Команда, которую исполняет пункт (`CommandRegistry.execute`). */
    readonly command: string;
    /** Явный label. Иначе — title команды из `CommandRegistry`, иначе — id команды. */
    readonly title?: string;
    /** Условие видимости через контекст-ключи (`ContextKeyService.evaluate`). */
    readonly when?: string;
    /**
     * Императивная видимость по контексту открытия — escape-hatch для состояния,
     * не отражённого в контекст-ключах (например непустой буфер обмена файлов).
     */
    readonly visible?: (context: unknown) => boolean;
    /** Группа (напр. `"2_clipboard"`); сортируется как строка, разделяет группы сепаратором. */
    readonly group?: string;
    /** Порядок внутри группы (по возрастанию, стабильно). */
    readonly order?: number;
    readonly icon?: string;
    /** Аргументы для `execute`, резолвятся из контекста открытия (напр. путь файла в Explorer). */
    readonly args?: (context: unknown) => readonly unknown[];
    /** `false` — не показывать шорткат; строка — литерал; иначе — резолв из `KeybindingRegistry`. */
    readonly shortcut?: string | false;
    /**
     * When-выражение «пункт сейчас включён» (аналог `toggled` у `registerAction2`).
     * Истина рисует отметку — так помечается активный элемент в submenu-выборе
     * (например текущий канал Output).
     */
    readonly toggled?: string;
}

/**
 * Submenu-запись (аналог `ISubmenuItem` VS Code): пункт меню `menuId`,
 * открывающий вложенную точку `submenu`. Меню-бар — набор таких записей в
 * `MenuId.MenubarMainMenu` (File/Edit/… → `MenubarFileMenu`/…).
 */
export interface ISubmenuContribution {
    readonly menuId: MenuId;
    /** Вложенная точка, чьи пункты открывает эта запись. */
    readonly submenu: MenuId;
    readonly title: string;
    /** Мнемоника top-уровня меню-бара (Alt+буква); у vscode — `&&` в title. */
    readonly mnemonic?: string;
    /** Условие видимости через контекст-ключи (`ContextKeyService.evaluate`). */
    readonly when?: string;
    /** Императивная видимость по контексту открытия (как у {@link IMenuContribution}). */
    readonly visible?: (context: unknown) => boolean;
    readonly group?: string;
    readonly order?: number;
    /**
     * Submenu — это выбор одного из вариантов (аналог `isSelection` у VS Code).
     * Такое submenu рендерится не вложенным попапом, а выпадающим списком:
     * `SubmenuEntrySelectActionViewItem` в VS Code, `SelectBoxElement` у нас.
     */
    readonly isSelection?: boolean;
}

export type MenuContribution = IMenuContribution | ISubmenuContribution;

export function isSubmenuContribution(item: MenuContribution): item is ISubmenuContribution {
    return "submenu" in item;
}

export const MenuContributionsDIToken = token<readonly MenuContribution[]>("MenuContributions");
