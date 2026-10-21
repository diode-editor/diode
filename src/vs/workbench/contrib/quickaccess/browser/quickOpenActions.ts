import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";

import { CommandsQuickAccessProvider } from "./commandsQuickAccessProvider.ts";
import { GotoLineQuickAccessProvider } from "./gotoLineQuickAccessProvider.ts";
import { OpenEditorsQuickAccessProvider } from "./openEditorsQuickAccessProvider.ts";
import { QuickOpenServiceDIToken } from "./quickOpenService.ts";

/** Не строка — игнорируется, как в VS Code. */
function prefillOf(args: readonly unknown[]): string {
    return typeof args[0] === "string" ? args[0] : "";
}

export const quickOpenAction: CommandAction = {
    id: "workbench.action.quickOpen",
    title: "Go to File...",
    menus: [{ menuId: MenuId.MenubarGoMenu, group: "1_goto", order: 10 }],
    keybinding: parseKeybinding("mod+p"),
    run(accessor, ...args) {
        accessor.get(QuickOpenServiceDIToken).show(prefillOf(args));
    },
};

export const gotoLineAction: CommandAction = {
    id: "workbench.action.gotoLine",
    title: "Go to Line/Column...",
    menus: [{ menuId: MenuId.MenubarGoMenu, group: "1_goto", order: 20 }],
    keybinding: parseKeybinding("ctrl+g"),
    run(accessor, ...args) {
        accessor.get(QuickOpenServiceDIToken).show(GotoLineQuickAccessProvider.PREFIX + prefillOf(args));
    },
};

export const showCommandsAction: CommandAction = {
    id: "workbench.action.showCommands",
    title: "Show All Commands",
    menus: [
        { menuId: MenuId.MenubarViewMenu, title: "Command Palette...", group: "1_palette", order: 10 },
        // Последний пункт контекст-меню редактора — как в эталоне
        // (`quickAccess.contribution.ts`, группа `z_commands`).
        { menuId: MenuId.EditorContext, title: "Command Palette...", group: "z_commands", order: 1 },
    ],
    keybinding: parseKeybinding("mod+shift+p"),
    // F1 — второй бинд палитры (дословно VS Code; Ctrl+K Ctrl+P отдан showAllEditors). Безусловен
    // намеренно: под `tier == 'legacy'` он пропадал, когда tier поднят (tmux 3.4 + kitty, первая
    // CSI-u клавиша), а расширенные клавиши не доходят — редактор оставался без палитры.
    keybindings: [parseKeybinding("f1")],
    run(accessor, ...args) {
        accessor.get(QuickOpenServiceDIToken).show(CommandsQuickAccessProvider.PREFIX + prefillOf(args));
    },
};

export const showAllEditorsAction: CommandAction = {
    id: "workbench.action.showAllEditors",
    title: "Show All Editors",
    menus: [{ menuId: MenuId.MenubarViewMenu, title: "Open Editors...", group: "1_palette", order: 20 }],
    // Аккорд из двух ctrl+буква проходит терминалом любого tier'а — legacy-фоллбэк не нужен.
    keybinding: parseChord("ctrl+k ctrl+p"),
    run(accessor, ...args) {
        accessor.get(QuickOpenServiceDIToken).show(OpenEditorsQuickAccessProvider.PREFIX + prefillOf(args));
    },
};

export const QUICK_ACCESS_ACTIONS: readonly CommandAction[] = [
    quickOpenAction,
    showCommandsAction,
    showAllEditorsAction,
    gotoLineAction,
];
