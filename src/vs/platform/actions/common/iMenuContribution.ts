import type { IProductIcon } from "../../../base/common/codicons.ts";
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
    /** A product icon follows `diode.icons.nerdFont`; a plain string is a literal. */
    readonly icon?: IProductIcon | string;
    /**
     * A theme color id for the icon of a button (upstream colors codicons by CSS rules, `debugColors.ts`: the debug
     * toolbar and its docked copy in the Run and Debug title).
     */
    readonly iconColor?: string;
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
    /**
     * Upstream `ISubmenuItem.isSplitButton`: in a title bar, a button running one item of the submenu plus an
     * arrow opening all of them. The button runs the first item; with `togglePrimaryAction` the one last picked
     * from the arrow, remembered per workspace.
     */
    readonly isSplitButton?: boolean | { readonly togglePrimaryAction: true };
    /** The split button's glyph when its item has none of its own (an extension command with an SVG icon). */
    readonly icon?: IProductIcon | string;
}

export type MenuContribution = IMenuContribution | ISubmenuContribution;

export function isSubmenuContribution(item: MenuContribution): item is ISubmenuContribution {
    return "submenu" in item;
}

export const MenuContributionsDIToken = token<readonly MenuContribution[]>("MenuContributions");
