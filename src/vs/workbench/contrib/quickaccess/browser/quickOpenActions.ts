import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";

import { CommandsQuickAccessProvider } from "./commandsQuickAccessProvider.ts";
import { GotoLineQuickAccessProvider } from "./gotoLineQuickAccessProvider.ts";
import { QuickOpenServiceDIToken } from "./quickOpenService.ts";

/**
 * Строковый аргумент команды (например, `args` у правила keybindings.json) —
 * префилл строки ввода Quick Open. Всё прочее (нет аргумента, не строка)
 * игнорируется, как в VS Code.
 */
function prefillOf(args: readonly unknown[]): string {
    return typeof args[0] === "string" ? args[0] : "";
}

export const quickOpenAction: CommandAction = {
    id: "workbench.action.quickOpen",
    title: "Go to File...",
    menus: [{ menuId: MenuId.MenubarGoMenu, group: "1_goto", order: 10 }],
    keybinding: parseKeybinding("ctrl+p"),
    run(accessor, ...args) {
        // Аргумент — запрос целиком (VS Code parity): ">тест" откроет команды,
        // ":12" — переход к строке, просто текст — поиск файла.
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
    menus: [{ menuId: MenuId.MenubarViewMenu, title: "Command Palette...", group: "1_palette", order: 10 }],
    keybinding: parseKeybinding("ctrl+shift+p"),
    // Ctrl+Shift+letter is unreliable on legacy terminals — add the VS Code chord fallback.
    keybindings: [{ keys: parseChord("ctrl+k ctrl+p"), when: "tier == 'legacy'" }],
    run(accessor, ...args) {
        accessor.get(QuickOpenServiceDIToken).show(CommandsQuickAccessProvider.PREFIX + prefillOf(args));
    },
};
