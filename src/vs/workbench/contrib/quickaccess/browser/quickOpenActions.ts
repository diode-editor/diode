import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../../platform/keybinding/common/keybindingResolver.ts";

import { CommandsQuickAccessProvider } from "./commandsQuickAccessProvider.ts";
import { GotoLineQuickAccessProvider } from "./gotoLineQuickAccessProvider.ts";
import { OpenEditorsQuickAccessProvider } from "./openEditorsQuickAccessProvider.ts";
import { QuickOpenServiceDIToken } from "./quickOpenService.ts";

/** A non-string is ignored, as in VS Code. */
function prefillOf(args: readonly unknown[]): string {
    return typeof args[0] === "string" ? args[0] : "";
}

export const quickOpenAction: CommandAction = {
    id: "workbench.action.quickOpen",
    title: "Go to File...",
    menus: [{ menuId: MenuId.MenubarGoMenu, group: "1_goto", order: 10 }],
    keybinding: parseKeybinding("mod+p"),
    // Upstream `globalQuickAccessKeybinding.secondary`; not on the Mac (`MAC_KEYBINDING_DELTAS`), where ⌃E is `cursorLineEnd`.
    keybindings: [parseKeybinding("ctrl+e")],
    run(accessor, ...args) {
        accessor.get(QuickOpenServiceDIToken).show(prefillOf(args));
    },
};

/** Not in the palette, as upstream: these are bindings, not things to look up by name. */
const HIDDEN_FROM_PALETTE = [{ menuId: MenuId.CommandPalette, when: "false" }];

/**
 * Upstream registers it via `CommandsRegistry` with no binding: for user keybindings and `executeCommand`.
 * The cursor lands on the second row — the previous file of the history.
 */
export const quickOpenPreviousEditorAction: CommandAction = {
    id: "workbench.action.quickOpenPreviousEditor",
    title: "Quick Open Previous Editor",
    menus: HIDDEN_FROM_PALETTE,
    run(accessor) {
        accessor.get(QuickOpenServiceDIToken).show("", { activateSecond: true });
    },
};

/**
 * Pressing the Quick Open keys again in the files picker steps down the list: Ctrl+E Ctrl+E Enter returns
 * to the previous file. Upstream's weight (`WorkbenchContrib + 50`) beats `quickOpen` and `showCommands`
 * on the same keys. No accept on Ctrl release: a terminal does not report it reliably.
 */
export const quickOpenNavigateNextInFilePickerAction: CommandAction = {
    id: "workbench.action.quickOpenNavigateNextInFilePicker",
    title: "Navigate Next in Quick Open",
    menus: HIDDEN_FROM_PALETTE,
    // `inputWidgetFocus` scopes it to the picker's own input: the dispatcher swallows unscoped shortcuts behind an overlay.
    when: "inFilesPicker && inputWidgetFocus",
    weight: KeybindingWeight.WorkbenchContrib + 50,
    keybinding: parseKeybinding("mod+p"),
    keybindings: [parseKeybinding("ctrl+e")],
    run(accessor) {
        accessor.get(QuickOpenServiceDIToken).navigate(true);
    },
};

/** Shift+Ctrl does not reach the editor from a legacy terminal: there Ctrl+Shift+P is Ctrl+P. */
export const quickOpenNavigatePreviousInFilePickerAction: CommandAction = {
    id: "workbench.action.quickOpenNavigatePreviousInFilePicker",
    title: "Navigate Previous in Quick Open",
    menus: HIDDEN_FROM_PALETTE,
    when: "inFilesPicker && inputWidgetFocus",
    weight: KeybindingWeight.WorkbenchContrib + 50,
    keybinding: { keys: parseKeybinding("mod+shift+p"), when: "tier != 'legacy'" },
    keybindings: [{ keys: parseKeybinding("ctrl+shift+e"), when: "tier != 'legacy'" }],
    run(accessor) {
        accessor.get(QuickOpenServiceDIToken).navigate(false);
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
        // The last item of the editor context menu — as upstream
        // (`quickAccess.contribution.ts`, group `z_commands`).
        { menuId: MenuId.EditorContext, title: "Command Palette...", group: "z_commands", order: 1 },
    ],
    keybinding: parseKeybinding("mod+shift+p"),
    // F1 is the palette's second binding (same as VS Code; Ctrl+K Ctrl+P belongs to showAllEditors).
    // Unconditional on purpose: under `tier == 'legacy'` it vanished once the tier was raised (tmux 3.4 +
    // kitty, first CSI-u key) while extended keys didn't get through — the editor was left without a palette.
    keybindings: [parseKeybinding("f1")],
    run(accessor, ...args) {
        accessor.get(QuickOpenServiceDIToken).show(CommandsQuickAccessProvider.PREFIX + prefillOf(args));
    },
};

export const showAllEditorsAction: CommandAction = {
    id: "workbench.action.showAllEditors",
    title: "Show All Editors",
    menus: [{ menuId: MenuId.MenubarViewMenu, title: "Open Editors...", group: "1_palette", order: 20 }],
    // A chord of two ctrl+letter keys passes through a terminal of any tier — no legacy fallback needed.
    keybinding: parseChord("ctrl+k ctrl+p"),
    run(accessor, ...args) {
        accessor.get(QuickOpenServiceDIToken).show(OpenEditorsQuickAccessProvider.PREFIX + prefillOf(args));
    },
};

export const QUICK_ACCESS_ACTIONS: readonly CommandAction[] = [
    quickOpenAction,
    quickOpenPreviousEditorAction,
    quickOpenNavigateNextInFilePickerAction,
    quickOpenNavigatePreviousInFilePickerAction,
    showCommandsAction,
    showAllEditorsAction,
    gotoLineAction,
];
