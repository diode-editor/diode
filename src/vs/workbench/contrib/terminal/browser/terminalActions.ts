import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../../platform/keybinding/common/keybindingResolver.ts";
import { resolveTabTarget } from "../../../browser/actions/editorTabTarget.ts";
import {
    editorTabTargetArg,
    type EditorTitleMenuContext,
    viewMenuVisible,
} from "../../../browser/actions/menuContexts.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { WorkbenchContextKeysDIToken } from "../../../browser/workbenchContextKeys.ts";
import { SIDE_GROUP } from "../../../services/editor/common/editorGroupColumn.ts";
import { EditorGroupsServiceDIToken } from "../../../services/editor/common/editorGroupsService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";

import { TERMINAL_EDITOR_SCHEME, TerminalEditorPane } from "./terminalEditorPane.ts";
import { TerminalEditorServiceDIToken } from "./terminalEditorService.ts";
import type { TerminalTabMenuContext } from "./terminalPanelComponent.ts";
import { SWITCH_TERMINAL_COMMAND_ID, TerminalPanelComponentDIToken } from "./terminalPanelComponent.ts";
import { TERMINAL_VIEW_ID, TerminalServiceDIToken } from "./terminalService.ts";
import { SWITCH_TERMINAL_SHOW_TABS, terminalIndexedLabel } from "./terminalTabsList.ts";

/** Tiers where Ctrl+symbol is encoded unambiguously (in legacy, Ctrl+` is NUL). */
const MODERN_TIER = "tier == 'kitty' || tier == 'csi-u'";

/** `$(plus)` / `$(trash)`. */
const PLUS_ICON = "";
const TRASH_ICON = "";

/** Doesn't wake the lazy spawn; the view opens where it is, like upstream `showPanel`. */
function showTerminalView(accessor: ServiceAccessor): void {
    accessor.get(ViewsServiceDIToken).openView(TERMINAL_VIEW_ID, false, false);
}

/** Callers that need focus elsewhere (the tab list) move it afterwards. */
function showPanel(accessor: ServiceAccessor): void {
    showTerminalView(accessor);
    accessor.get(TerminalServiceDIToken).focusActive();
}

/** The terminal count changes without a focus change — refresh context keys and title buttons explicitly. */
function refreshContextKeys(accessor: ServiceAccessor): void {
    accessor.get(WorkbenchContextKeysDIToken).update();
}

function menuInstanceArg(context: unknown): readonly unknown[] {
    return [(context as TerminalTabMenuContext).instanceId];
}

// Ctrl+` is unambiguous only in csi-u/kitty (in legacy it is NUL = Ctrl+Space), so canonical
// bindings are tier-gated; the Ctrl+K T and Ctrl+K Alt+T chords are reachable everywhere.
export const toggleTerminalAction: CommandAction = {
    id: "workbench.action.terminal.toggleTerminal",
    title: "Terminal: Toggle Terminal",
    shortTitle: "Terminal",
    menus: [{ menuId: MenuId.MenubarViewMenu, group: "3_views", order: 30 }],
    keybinding: parseChord("ctrl+k t"),
    keybindings: [{ keys: parseKeybinding("ctrl+`"), when: MODERN_TIER }],
    run(accessor) {
        const views = accessor.get(ViewsServiceDIToken);
        const terminal = accessor.get(TerminalServiceDIToken);
        // An empty tab (the shell exited, a placeholder is left) is not "terminal shown":
        // there is nothing to hide, the command must spawn a new shell.
        const showing = views.isViewShown(TERMINAL_VIEW_ID) && terminal.hasOpenTerminals;
        if (showing) {
            views.closeView(TERMINAL_VIEW_ID);
        } else {
            showTerminalView(accessor);
            terminal.openTerminal();
            accessor.get(WorkbenchContextKeysDIToken).update();
        }
    },
};

// With Shift held, Kitty may send the shifted codepoint (`~`) instead of the base `` ` `` —
// it depends on the terminal, so register both forms: Ctrl+Shift+` and Ctrl+Shift+~.
export const newTerminalAction: CommandAction = {
    id: "workbench.action.terminal.new",
    title: "Terminal: Create New Terminal",
    shortTitle: "New Terminal",
    keybinding: parseChord("ctrl+k alt+t"),
    keybindings: [
        { keys: parseKeybinding("ctrl+shift+`"), when: MODERN_TIER },
        { keys: parseKeybinding("ctrl+shift+~"), when: MODERN_TIER },
    ],
    // The "+" button in the tab title — upstream always shows it.
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: 10,
            icon: PLUS_ICON,
            visible: viewMenuVisible(TERMINAL_VIEW_ID),
        },
        { menuId: MenuId.MenubarTerminalMenu, group: "1_create", order: 1 },
    ],
    run(accessor) {
        if (accessor.get(IConfigurationServiceDIToken).get("terminal.integrated.defaultLocation") === "editor") {
            accessor.get(TerminalEditorServiceDIToken).createTerminal();
        } else {
            showTerminalView(accessor);
            accessor.get(TerminalServiceDIToken).newTerminal();
        }
        accessor.get(WorkbenchContextKeysDIToken).update();
    },
};

export const createTerminalEditorAction: CommandAction = {
    id: "workbench.action.createTerminalEditor",
    title: "Terminal: Create New Terminal in Editor Area",
    // The focus change itself refreshes the keys: the tab opens focused.
    run(accessor) {
        accessor.get(TerminalEditorServiceDIToken).createTerminal();
    },
};

export const createTerminalEditorSideAction: CommandAction = {
    id: "workbench.action.createTerminalEditorSide",
    title: "Terminal: Create New Terminal in Editor Area to the Side",
    run(accessor) {
        accessor.get(TerminalEditorServiceDIToken).createTerminal({}, { viewColumn: SIDE_GROUP });
    },
};

/** Target is the instance from the tab menu, otherwise the active one (upstream `activeInstanceType: 'view'`). */
export const moveToEditorAction: CommandAction = {
    id: "workbench.action.terminal.moveToEditor",
    title: "Terminal: Move Terminal into Editor Area",
    shortTitle: "Move Terminal into Editor Area",
    when: "terminalIsOpen",
    menus: [{ menuId: MenuId.TerminalTabContext, group: "1_create", order: 2, args: menuInstanceArg }],
    run(accessor, instanceId) {
        const id =
            typeof instanceId === "number" ? instanceId : accessor.get(TerminalServiceDIToken).getActiveInstance()?.id;
        // Stryker disable next-line ConditionalExpression: equivalent — the service skips unknown ids; narrows the type
        if (id === undefined) return;
        // Focus moves to the tab — the focus change refreshes the keys.
        accessor.get(TerminalEditorServiceDIToken).moveToEditor(id);
    },
};

/** Target is the tab from its menu, otherwise the active tab if it is a terminal. */
export const moveToTerminalPanelAction: CommandAction = {
    id: "workbench.action.terminal.moveToTerminalPanel",
    title: "Terminal: Move Terminal into Panel",
    shortTitle: "Move Terminal into Panel",
    when: "terminalEditorActive",
    menus: [
        {
            menuId: MenuId.EditorTitleContext,
            group: "2_files",
            order: 10,
            args: editorTabTargetArg,
            visible: (context) => (context as EditorTitleMenuContext).resourceScheme === TERMINAL_EDITOR_SCHEME,
        },
    ],
    run(accessor, ...args) {
        const target = resolveTabTarget(accessor.get(EditorGroupsServiceDIToken), args);
        const pane = target?.group.getPane(target.index);
        if (!(pane instanceof TerminalEditorPane)) return;
        accessor.get(TerminalEditorServiceDIToken).moveToPanel(pane.instance.id);
        showPanel(accessor);
    },
};

/** Ctrl+W closes the tab and kills the process, as in upstream: the key doesn't reach the shell. */
export const killEditorAction: CommandAction = {
    id: "workbench.action.terminal.killEditor",
    title: "Terminal: Kill the Active Terminal in Editor Area",
    keybinding: parseKeybinding("mod+w"),
    when: "terminalFocus && terminalEditorFocus",
    weight: KeybindingWeight.WorkbenchContrib,
    run(accessor) {
        const groups = accessor.get(EditorGroupsServiceDIToken);
        const pane = groups.activeGroup.activePane;
        if (!(pane instanceof TerminalEditorPane)) return;
        void accessor.get(EditorServiceDIToken).closeEditor(groups.activeGroup, pane);
    },
};

export const focusTerminalAction: CommandAction = {
    id: "workbench.action.terminal.focus",
    title: "Terminal: Focus Terminal",
    run(accessor) {
        showPanel(accessor);
        accessor.get(TerminalServiceDIToken).openTerminal();
    },
};

// Ctrl+Shift+\ is unambiguous only in csi-u/kitty: in legacy Ctrl+\ is byte 0x1c
// (SIGQUIT for the shell) and Shift is lost. With Shift, Kitty may send `|`. The path reachable
// everywhere is the leader chord Ctrl+K \ (the terminal's Ctrl+K T / Ctrl+K Alt+T family).
export const focusTabsAction: CommandAction = {
    id: "workbench.action.terminal.focusTabs",
    title: "Terminal: Focus Terminal Tabs View",
    keybinding: parseChord("ctrl+k \\"),
    keybindings: [
        { keys: parseKeybinding("ctrl+shift+\\"), when: MODERN_TIER },
        { keys: parseKeybinding("ctrl+shift+|"), when: MODERN_TIER },
    ],
    when: "terminalTabsFocus || terminalFocus",
    weight: KeybindingWeight.WorkbenchContrib,
    run(accessor) {
        showPanel(accessor);
        accessor.get(TerminalPanelComponentDIToken).focusTabs();
    },
};

// Ctrl+PgDn/PgUp switch tabs in the editor (`textViewFocus`) and terminals here in
// the view (`terminalFocus`): the when clauses don't overlap, as in upstream. In a
// terminal editor tab the keys stay with the editor area (`!terminalEditorFocus`).
export const focusNextTerminalAction: CommandAction = {
    id: "workbench.action.terminal.focusNext",
    title: "Terminal: Focus Next Terminal Group",
    keybinding: parseKeybinding("ctrl+pagedown"),
    when: "terminalFocus && !terminalEditorFocus",
    weight: KeybindingWeight.WorkbenchContrib,
    run(accessor) {
        accessor.get(TerminalServiceDIToken).setActiveToNext();
        showPanel(accessor);
    },
};

export const focusPreviousTerminalAction: CommandAction = {
    id: "workbench.action.terminal.focusPrevious",
    title: "Terminal: Focus Previous Terminal Group",
    keybinding: parseKeybinding("ctrl+pageup"),
    when: "terminalFocus && !terminalEditorFocus",
    weight: KeybindingWeight.WorkbenchContrib,
    run(accessor) {
        accessor.get(TerminalServiceDIToken).setActiveToPrevious();
        showPanel(accessor);
    },
};

function killInstance(accessor: ServiceAccessor, id: number | undefined): void {
    const terminal = accessor.get(TerminalServiceDIToken);
    terminal.closeInstance(id);
    if (terminal.hasOpenTerminals) showPanel(accessor);
    refreshContextKeys(accessor);
}

export const killTerminalAction: CommandAction = {
    id: "workbench.action.terminal.kill",
    title: "Terminal: Kill the Active Terminal Instance",
    shortTitle: "Kill Terminal",
    // Upstream gates it on `tabs.showActions` (see the tracker).
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: 30,
            icon: TRASH_ICON,
            visible: viewMenuVisible(TERMINAL_VIEW_ID),
            when: "terminalIsOpen",
        },
    ],
    run(accessor) {
        killInstance(accessor, accessor.get(TerminalServiceDIToken).getActiveInstance()?.id);
    },
};

/** Target is the instance from the menu argument, otherwise the list row under the cursor. */
export const killActiveTabAction: CommandAction = {
    id: "workbench.action.terminal.killActiveTab",
    title: "Terminal: Kill Terminal",
    shortTitle: "Kill Terminal",
    keybinding: parseKeybinding("delete"),
    when: "terminalTabsFocus",
    weight: KeybindingWeight.WorkbenchContrib,
    menus: [{ menuId: MenuId.TerminalTabContext, group: "7_kill", order: 10, args: menuInstanceArg }],
    run(accessor, instanceId) {
        const component = accessor.get(TerminalPanelComponentDIToken);
        const id = typeof instanceId === "number" ? instanceId : component.tabs.getCursorInstanceId();
        accessor.get(TerminalServiceDIToken).closeInstance(id);
        // Focus goes to the list while it is visible, otherwise to the terminal (upstream calls `focusTabs()`).
        component.focusTabs();
        refreshContextKeys(accessor);
    },
};

export const killAllTerminalsAction: CommandAction = {
    id: "workbench.action.terminal.killAll",
    title: "Terminal: Kill All Terminals",
    run(accessor) {
        const terminal = accessor.get(TerminalServiceDIToken);
        for (const instance of [...terminal.getInstances()]) terminal.closeInstance(instance.id);
        refreshContextKeys(accessor);
    },
};

/** The argument is a dropdown item label (`tabs.enabled=false`); without it, a quick pick. */
export const switchTerminalAction: CommandAction = {
    id: SWITCH_TERMINAL_COMMAND_ID,
    title: "Terminal: Switch Terminal",
    async run(accessor, label) {
        if (typeof label !== "string") {
            await pickTerminal(accessor);
            return;
        }
        if (label === SWITCH_TERMINAL_SHOW_TABS) {
            await accessor.get(IConfigurationServiceDIToken).updateValue("terminal.integrated.tabs.enabled", true);
            return;
        }
        // Look up the `N: title` label among the current labels instead of parsing it, so
        // an unknown string (separator, stale item) is simply not found.
        const terminal = accessor.get(TerminalServiceDIToken);
        const index = terminal.getInstances().findIndex((instance, i) => terminalIndexedLabel(i, instance) === label);
        if (index < 0) return;
        terminal.setActiveInstanceByIndex(index);
        showPanel(accessor);
    },
};

const CREATE_NEW_TERMINAL_LABEL = "Create New Terminal";

async function pickTerminal(accessor: ServiceAccessor): Promise<void> {
    const terminal = accessor.get(TerminalServiceDIToken);
    const instances = terminal.getInstances();
    const active = terminal.getActiveInstance();
    const items = [
        ...instances.map((instance, index) => ({ label: terminalIndexedLabel(index, instance) })),
        { label: CREATE_NEW_TERMINAL_LABEL },
    ];
    const picked = await accessor.get(QuickInputServiceDIToken).quickPick({
        placeholder: "Type the name of a terminal to open.",
        items,
        // No active one — -1; the picker clamps it to the first row.
        activeIndex: instances.findIndex((instance) => instance === active),
    });
    if (picked === undefined) return;
    const index = items.indexOf(picked);
    if (index === instances.length) {
        newTerminalAction.run(accessor);
        return;
    }
    terminal.setActiveInstance(instances[index].id);
    showPanel(accessor);
}

export const quickOpenTermAction: CommandAction = {
    id: "workbench.action.quickOpenTerm",
    title: "Terminal: Switch Active Terminal",
    run(accessor) {
        return pickTerminal(accessor);
    },
};

export const TERMINAL_ACTIONS: readonly CommandAction[] = [
    toggleTerminalAction,
    newTerminalAction,
    createTerminalEditorAction,
    createTerminalEditorSideAction,
    moveToEditorAction,
    moveToTerminalPanelAction,
    killEditorAction,
    focusTerminalAction,
    focusTabsAction,
    focusNextTerminalAction,
    focusPreviousTerminalAction,
    killTerminalAction,
    killActiveTabAction,
    killAllTerminalsAction,
    switchTerminalAction,
    quickOpenTermAction,
];
