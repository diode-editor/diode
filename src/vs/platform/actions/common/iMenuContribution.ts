import { token } from "../../instantiation/common/diContainer.ts";

import type { MenuId } from "./menuId.ts";

export interface IMenuContribution {
    readonly menuId: MenuId;
    readonly command: string;
    /** Иначе — title команды из `CommandRegistry`, иначе — id команды. */
    readonly title?: string;
    readonly when?: string;
    /**
     * В отличие от `when`, пункт остаётся на месте, но гасится и не исполняется.
     * Деривируется: `CommandAction.enablement` AND `CommandMenuPlacement.enablement`.
     */
    readonly enablement?: string;
    /** Escape-hatch для состояния вне контекст-ключей (непустой буфер обмена файлов). */
    readonly visible?: (context: unknown) => boolean;
    /** Сортируется как строка. */
    readonly group?: string;
    readonly order?: number;
    readonly icon?: string;
    readonly args?: (context: unknown) => readonly unknown[];
    /** `false` — не показывать шорткат; строка — литерал; иначе — резолв из `KeybindingRegistry`. */
    readonly shortcut?: string | false;
    /** Истина рисует отметку активного элемента submenu-выбора (`toggled` у `registerAction2`). */
    readonly toggled?: string;
}

/** Меню-бар — набор таких записей в `MenuId.MenubarMainMenu`. */
export interface ISubmenuContribution {
    readonly menuId: MenuId;
    readonly submenu: MenuId;
    readonly title: string;
    /** Alt+буква top-уровня меню-бара; у vscode — `&&` в title. */
    readonly mnemonic?: string;
    readonly when?: string;
    readonly visible?: (context: unknown) => boolean;
    readonly group?: string;
    readonly order?: number;
    /** Рендерится выпадающим списком (`SelectBoxElement`), а не вложенным попапом. */
    readonly isSelection?: boolean;
}

export type MenuContribution = IMenuContribution | ISubmenuContribution;

export function isSubmenuContribution(item: MenuContribution): item is ISubmenuContribution {
    return "submenu" in item;
}

export const MenuContributionsDIToken = token<readonly MenuContribution[]>("MenuContributions");
