import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { PanelServiceDIToken } from "../../../browser/parts/panel/panelService.ts";
import { WorkbenchContextKeysDIToken } from "../../../browser/workbenchContextKeys.ts";
import { LayoutServiceDIToken } from "../../../services/layout/browser/layoutService.ts";

import { TERMINAL_VIEW_ID, TerminalServiceDIToken } from "./terminalService.ts";

// Integrated Terminal. Только tier csi-u/kitty умеет однозначно кодировать
// Ctrl+` (в legacy это NUL = Ctrl+Space), поэтому канонические бинды под
// tier-гейтом, а досягаемые везде пути — лидер-аккорды Ctrl+K T (в семье
// Ctrl+K F / Ctrl+K G / Ctrl+K E, которой открываются вьюлеты и панели) и
// Ctrl+K Alt+T для новой вкладки терминала.
export const toggleTerminalAction: CommandAction = {
    id: "workbench.action.terminal.toggleTerminal",
    title: "Terminal: Toggle Terminal",
    shortTitle: "Terminal",
    menus: [{ menuId: MenuId.MenubarViewMenu, group: "3_views", order: 30 }],
    keybinding: parseChord("ctrl+k t"),
    keybindings: [{ keys: parseKeybinding("ctrl+`"), when: "tier == 'kitty' || tier == 'csi-u'" }],
    run(accessor) {
        // Toggle like VS Code: hide the panel if Terminal is already the
        // visible view, otherwise show + spawn/focus a terminal.
        const layout = accessor.get(LayoutServiceDIToken);
        const panel = accessor.get(PanelServiceDIToken);
        const terminal = accessor.get(TerminalServiceDIToken);
        // Пустая вкладка (шелл вышел, остался placeholder) — это не «терминал показан»:
        // прятать нечего, команда должна поднять новый шелл.
        const showing =
            layout.isPanelVisible() && panel.getActiveViewId() === TERMINAL_VIEW_ID && terminal.hasOpenTerminals;
        if (showing) {
            layout.setPanelVisible(false);
        } else {
            panel.setActiveView(TERMINAL_VIEW_ID);
            layout.setPanelVisible(true);
            terminal.openTerminal();
            accessor.get(WorkbenchContextKeysDIToken).update();
        }
    },
};

// С зажатым Shift Kitty может слать shifted codepoint (`~`) вместо базового `` ` `` —
// зависит от терминала, поэтому регистрируем обе формы: Ctrl+Shift+` и Ctrl+Shift+~.
export const newTerminalAction: CommandAction = {
    id: "workbench.action.terminal.new",
    title: "Terminal: Create New Terminal",
    keybinding: parseChord("ctrl+k alt+t"),
    keybindings: [
        { keys: parseKeybinding("ctrl+shift+`"), when: "tier == 'kitty' || tier == 'csi-u'" },
        { keys: parseKeybinding("ctrl+shift+~"), when: "tier == 'kitty' || tier == 'csi-u'" },
    ],
    run(accessor) {
        accessor.get(PanelServiceDIToken).setActiveView(TERMINAL_VIEW_ID);
        accessor.get(LayoutServiceDIToken).setPanelVisible(true);
        accessor.get(TerminalServiceDIToken).newTerminal();
        accessor.get(WorkbenchContextKeysDIToken).update();
    },
};
