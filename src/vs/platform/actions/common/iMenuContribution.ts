import { token } from "../../instantiation/common/diContainer.ts";

import type { MenuId } from "./menuId.ts";

export interface IMenuContribution {
    readonly menuId: MenuId;
    readonly command: string;
    /** Falls back to the command title from `CommandRegistry`, then to the command id. */
    readonly title?: string;
    readonly when?: string;
    /**
     * Unlike `when`, the item stays in place but is disabled and does not run.
     * Derived: `CommandAction.enablement` AND `CommandMenuPlacement.enablement`.
     */
    readonly enablement?: string;
    /** Escape hatch for state outside context keys (a non-empty file clipboard). */
    readonly visible?: (context: unknown) => boolean;
    /** Sorted as a string. */
    readonly group?: string;
    readonly order?: number;
    readonly icon?: string;
    readonly args?: (context: unknown) => readonly unknown[];
    /** `false` hides the shortcut; a string is a literal; otherwise it is resolved from `KeybindingRegistry`. */
    readonly shortcut?: string | false;
    /** When true, renders the active-item check mark of a selection submenu (`toggled` of `registerAction2`). */
    readonly toggled?: string;
}

/** The menu bar is a set of these entries in `MenuId.MenubarMainMenu`. */
export interface ISubmenuContribution {
    readonly menuId: MenuId;
    readonly submenu: MenuId;
    readonly title: string;
    /** Alt+letter for a top-level menu bar entry; vscode uses `&&` in the title. */
    readonly mnemonic?: string;
    readonly when?: string;
    readonly visible?: (context: unknown) => boolean;
    readonly group?: string;
    readonly order?: number;
    /** Rendered as a dropdown (`SelectBoxElement`) instead of a nested popup. */
    readonly isSelection?: boolean;
}

export type MenuContribution = IMenuContribution | ISubmenuContribution;

export function isSubmenuContribution(item: MenuContribution): item is ISubmenuContribution {
    return "submenu" in item;
}

export const MenuContributionsDIToken = token<readonly MenuContribution[]>("MenuContributions");
