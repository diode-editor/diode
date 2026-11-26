// The commands of the Run and Debug viewlet with upstream's ids, titles, keys and `when`: showing it
// (`debug.contribution.ts`), Collapse All of VARIABLES (`variablesView.ts`), the WATCH title and keys
// (`watchExpressionsView.ts`, `debugCommands.ts`), Collapse All of CALL STACK (`callStackView.ts`) and of LOADED
// SCRIPTS (`loadedScriptsView.ts`), the BREAKPOINTS
// title, its keys and the palette commands of the breakpoints (`breakpointsView.ts`, `debugCommands.ts`).
// Deviations: Ctrl+Shift+D and Ctrl+Enter reach only terminals with extended keys; Ctrl+K B shows the viewlet
// everywhere (Ctrl+K D, the free letter of the other viewlets, is Compare with Saved); the name of a new function
// breakpoint is typed in the quick input, not in an input box on the row. The rows' menu items of WATCH and
// BREAKPOINTS are on these commands; the editing commands of breakpoints are in `breakpointEditActions.ts`. Not here
// yet: the entries of the Run menu (no Run menu yet).

import { codicon } from "../../../../base/common/codicons.ts";
import { type CommandAction, HIDDEN_FROM_PALETTE } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { ClipboardDIToken } from "../../../../platform/clipboard/common/iClipboard.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../../platform/keybinding/common/keybindingResolver.ts";
import { viewMenuVisible } from "../../../browser/actions/menuContexts.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import { SidebarServiceDIToken } from "../../../browser/parts/sidebar/sidebarService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import {
    BREAKPOINTS_VIEW_ID,
    CALLSTACK_VIEW_ID,
    LOADED_SCRIPTS_VIEW_ID,
    VARIABLES_VIEW_ID,
    VIEWLET_ID,
    WATCH_VIEW_ID,
} from "../common/debug.ts";
import {
    Breakpoint,
    DataBreakpoint,
    Expression,
    FunctionBreakpoint,
    InstructionBreakpoint,
} from "../common/debugModel.ts";

import { rowMenuItem } from "./debugContextMenus.ts";
import { DebugServiceDIToken } from "./debugService.ts";
import { type DebugViewletComponent, DebugViewletComponentDIToken } from "./debugViewlet.ts";

export const ADD_WATCH_ID = "workbench.debug.viewlet.action.addWatchExpression";
export const REMOVE_WATCH_EXPRESSIONS_COMMAND_ID = "workbench.debug.viewlet.action.removeAllWatchExpressions";
export const COPY_ALL_WATCH_EXPRESSIONS_COMMAND_ID = "workbench.debug.viewlet.action.copyAllWatchExpressions";
export const EDIT_EXPRESSION_COMMAND_ID = "debug.renameWatchExpression";
export const REMOVE_EXPRESSION_COMMAND_ID = "debug.removeWatchExpression";

const COLLAPSE_ICON = codicon("collapse-all");

const NOT_EXCEPTION_BREAKPOINT = "breakpointItemType != 'exceptionBreakpoint'";
const BREAKPOINTS_ROW = `breakpointsExist && ${NOT_EXCEPTION_BREAKPOINT}`;

/** The expression a WATCH command acts on: its argument (a row of a menu), else the focused row of the view. */
export function watchExpressionOf(accessor: ServiceAccessor, arg: unknown): Expression | undefined {
    if (arg instanceof Expression) return arg;
    const focused = accessor.get(DebugViewletComponentDIToken).watch.tree.focused;
    return focused instanceof Expression ? focused : undefined;
}

export const showRunAndDebugAction: CommandAction = {
    id: VIEWLET_ID,
    title: "View: Show Run and Debug",
    shortTitle: "Run",
    menus: [{ menuId: MenuId.MenubarViewMenu, group: "3_views", order: 15.5 }],
    keybinding: parseChord("ctrl+k b"),
    keybindings: [{ keys: parseKeybinding("mod+shift+d"), when: "tier != 'legacy'" }],
    run(accessor) {
        accessor.get(SidebarServiceDIToken).showViewlet(VIEWLET_ID);
    },
};

export const collapseVariablesAction: CommandAction = {
    id: "variables.collapse",
    title: "Collapse All",
    menus: [
        ...HIDDEN_FROM_PALETTE,
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            icon: COLLAPSE_ICON,
            visible: viewMenuVisible(VARIABLES_VIEW_ID),
        },
    ],
    run(accessor) {
        accessor.get(DebugViewletComponentDIToken).variables.tree.collapseAll();
    },
};

export const addWatchExpressionAction: CommandAction = {
    id: ADD_WATCH_ID,
    title: "Add Expression",
    menus: [
        ...HIDDEN_FROM_PALETTE,
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: 10,
            icon: codicon("add"),
            visible: viewMenuVisible(WATCH_VIEW_ID),
        },
        rowMenuItem(MenuId.DebugWatchContext, "3_modification", 10),
    ],
    run(accessor) {
        accessor.get(DebugServiceDIToken).addWatchExpression();
    },
};

export const removeAllWatchExpressionsAction: CommandAction = {
    id: REMOVE_WATCH_EXPRESSIONS_COMMAND_ID,
    title: "Remove All Expressions",
    enablement: "watchExpressionsExist",
    menus: [
        ...HIDDEN_FROM_PALETTE,
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: 20,
            icon: codicon("close-all"),
            visible: viewMenuVisible(WATCH_VIEW_ID),
        },
        rowMenuItem(MenuId.DebugWatchContext, "z_commands", 20),
    ],
    run(accessor) {
        accessor.get(DebugServiceDIToken).removeWatchExpressions();
    },
};

export const collapseWatchAction: CommandAction = {
    id: "watch.collapse",
    title: "Collapse All",
    enablement: "watchExpressionsExist",
    menus: [
        ...HIDDEN_FROM_PALETTE,
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: 30,
            icon: COLLAPSE_ICON,
            visible: viewMenuVisible(WATCH_VIEW_ID),
        },
    ],
    run(accessor) {
        accessor.get(DebugViewletComponentDIToken).watch.tree.collapseAll();
    },
};

export const copyAllWatchExpressionsAction: CommandAction = {
    id: COPY_ALL_WATCH_EXPRESSIONS_COMMAND_ID,
    title: "Copy All",
    enablement: "watchExpressionsExist",
    menus: [...HIDDEN_FROM_PALETTE, rowMenuItem(MenuId.DebugWatchContext, "3_modification", 45)],
    run(accessor) {
        const watches = accessor.get(DebugServiceDIToken).getModel().getWatchExpressions();
        const lines = watches.map((w) => `${w.name}: ${w.value}`);
        return accessor.get(ClipboardDIToken).writeText(lines.join("\n"));
    },
};

export const renameWatchExpressionAction: CommandAction = {
    id: EDIT_EXPRESSION_COMMAND_ID,
    title: "Edit Expression",
    keybinding: {
        keys: parseKeybinding("f2"),
        when: "watchExpressionsFocused",
        weight: KeybindingWeight.WorkbenchContrib + 5,
    },
    menus: [
        ...HIDDEN_FROM_PALETTE,
        rowMenuItem(MenuId.DebugWatchContext, "3_modification", 20, "watchItemType == 'expression'"),
    ],
    run(accessor, expression) {
        const target = watchExpressionOf(accessor, expression);
        if (target) accessor.get(DebugServiceDIToken).getViewModel().setSelectedExpression(target, false);
    },
};

export const removeWatchExpressionAction: CommandAction = {
    id: REMOVE_EXPRESSION_COMMAND_ID,
    title: "Remove Expression",
    keybinding: {
        keys: parseKeybinding("delete"),
        when: "watchExpressionsFocused && !expressionSelected",
        weight: KeybindingWeight.WorkbenchContrib,
    },
    menus: HIDDEN_FROM_PALETTE,
    run(accessor, expression) {
        const target = watchExpressionOf(accessor, expression);
        if (target) accessor.get(DebugServiceDIToken).removeWatchExpressions(target.getId());
    },
};

export const collapseCallStackAction: CommandAction = {
    id: "callStack.collapse",
    title: "Collapse All",
    enablement: "debugState == 'stopped'",
    menus: [
        ...HIDDEN_FROM_PALETTE,
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: 10,
            icon: COLLAPSE_ICON,
            visible: viewMenuVisible(CALLSTACK_VIEW_ID),
        },
    ],
    run(accessor) {
        accessor.get(DebugViewletComponentDIToken).callStack.tree.collapseAll();
    },
};

/** BREAKPOINTS, whose row under the cursor is upstream's focused element of the last focused list. */
function breakpointsView(accessor: ServiceAccessor): DebugViewletComponent["breakpoints"] {
    return accessor.get(DebugViewletComponentDIToken).breakpoints;
}

export const toggleBreakpointAction: CommandAction = {
    id: "debug.toggleBreakpoint",
    title: "Toggle Breakpoint",
    keybinding: {
        keys: parseKeybinding("space"),
        when: "breakpointsFocused",
        weight: KeybindingWeight.WorkbenchContrib + 5,
    },
    menus: HIDDEN_FROM_PALETTE,
    run(accessor) {
        const focused = breakpointsView(accessor).focusedBreakpoint;
        if (focused) return accessor.get(DebugServiceDIToken).enableOrDisableBreakpoints(!focused.enabled, focused);
        return undefined;
    },
};

export const removeFocusedBreakpointAction: CommandAction = {
    id: "debug.removeBreakpoint",
    title: "Remove Breakpoint",
    keybinding: {
        keys: parseKeybinding("delete"),
        when: "breakpointsFocused && !breakpointInputFocused",
        weight: KeybindingWeight.WorkbenchContrib,
    },
    menus: HIDDEN_FROM_PALETTE,
    run(accessor) {
        const debugService = accessor.get(DebugServiceDIToken);
        const element = breakpointsView(accessor).focusedBreakpoint;
        if (element instanceof Breakpoint) return debugService.removeBreakpoints(element.getId());
        if (element instanceof FunctionBreakpoint) return debugService.removeFunctionBreakpoints(element.getId());
        if (element instanceof DataBreakpoint) return debugService.removeDataBreakpoints(element.getId());
        return undefined;
    },
};

/** The Remove Breakpoint of a row's menu, with the row as its argument; unlike the Delete key it takes instructions. */
export const removeBreakpointAction: CommandAction = {
    id: "workbench.debug.viewlet.action.removeBreakpoint",
    title: "Remove Breakpoint",
    menus: [
        ...HIDDEN_FROM_PALETTE,
        rowMenuItem(MenuId.DebugBreakpointsContext, "3_modification", 10, NOT_EXCEPTION_BREAKPOINT),
    ],
    async run(accessor, breakpoint) {
        const debugService = accessor.get(DebugServiceDIToken);
        if (breakpoint instanceof Breakpoint) {
            await debugService.removeBreakpoints(breakpoint.getId());
        } else if (breakpoint instanceof FunctionBreakpoint) {
            await debugService.removeFunctionBreakpoints(breakpoint.getId());
        } else if (breakpoint instanceof DataBreakpoint) {
            await debugService.removeDataBreakpoints(breakpoint.getId());
        } else if (breakpoint instanceof InstructionBreakpoint) {
            await debugService.removeInstructionBreakpoints(breakpoint.instructionReference, breakpoint.offset);
        }
    },
};

export const openBreakpointToSideAction: CommandAction = {
    id: "debug.openBreakpointToSide",
    title: "Open to the Side",
    keybinding: { keys: parseKeybinding("alt+enter"), when: "breakpointsFocused" },
    keybindings: [{ keys: parseKeybinding("ctrl+enter"), when: "breakpointsFocused && tier != 'legacy'" }],
    weight: KeybindingWeight.WorkbenchContrib,
    menus: HIDDEN_FROM_PALETTE,
    run(accessor) {
        const focused = breakpointsView(accessor).focusedBreakpoint;
        if (focused instanceof Breakpoint) return breakpointsView(accessor).openBreakpoint(focused, true);
        return undefined;
    },
};

export const addFunctionBreakpointAction: CommandAction = {
    id: "workbench.debug.viewlet.action.addFunctionBreakpointAction",
    title: "Add Function Breakpoint",
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: 10,
            icon: codicon("add"),
            visible: viewMenuVisible(BREAKPOINTS_VIEW_ID),
        },
    ],
    async run(accessor) {
        const debugService = accessor.get(DebugServiceDIToken);
        const quickInput = accessor.get(QuickInputServiceDIToken);
        accessor.get(ViewsServiceDIToken).openView(BREAKPOINTS_VIEW_ID);
        // Upstream's input box on the new row: an empty name adds nothing.
        const name = await quickInput.input({ placeholder: "Function to break on" });
        if (name) await debugService.addFunctionBreakpoint({ name });
    },
};

export const toggleBreakpointsActivatedAction: CommandAction = {
    id: "workbench.debug.viewlet.action.toggleBreakpointsActivatedAction",
    title: "Toggle Activate Breakpoints",
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: 20,
            icon: codicon("activate-breakpoints"),
            visible: viewMenuVisible(BREAKPOINTS_VIEW_ID),
        },
    ],
    run(accessor) {
        const debugService = accessor.get(DebugServiceDIToken);
        return debugService.setBreakpointsActivated(!debugService.getModel().areBreakpointsActivated());
    },
};

export const removeAllBreakpointsAction: CommandAction = {
    id: "workbench.debug.viewlet.action.removeAllBreakpoints",
    title: "Remove All Breakpoints",
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: 30,
            icon: codicon("close-all"),
            visible: viewMenuVisible(BREAKPOINTS_VIEW_ID),
        },
        rowMenuItem(MenuId.DebugBreakpointsContext, "3_modification", 20, BREAKPOINTS_ROW),
    ],
    async run(accessor) {
        const debugService = accessor.get(DebugServiceDIToken);
        await Promise.all([
            debugService.removeBreakpoints(),
            debugService.removeFunctionBreakpoints(),
            debugService.removeDataBreakpoints(),
            debugService.removeInstructionBreakpoints(),
        ]);
    },
};

export const enableAllBreakpointsAction: CommandAction = {
    id: "workbench.debug.viewlet.action.enableAllBreakpoints",
    title: "Enable All Breakpoints",
    enablement: "debuggersAvailable",
    menus: [rowMenuItem(MenuId.DebugBreakpointsContext, "z_commands", 10, BREAKPOINTS_ROW)],
    run(accessor) {
        return accessor.get(DebugServiceDIToken).enableOrDisableBreakpoints(true);
    },
};

export const disableAllBreakpointsAction: CommandAction = {
    id: "workbench.debug.viewlet.action.disableAllBreakpoints",
    title: "Disable All Breakpoints",
    enablement: "debuggersAvailable",
    menus: [rowMenuItem(MenuId.DebugBreakpointsContext, "z_commands", 20, BREAKPOINTS_ROW)],
    run(accessor) {
        return accessor.get(DebugServiceDIToken).enableOrDisableBreakpoints(false);
    },
};

export const reapplyBreakpointsAction: CommandAction = {
    id: "workbench.debug.viewlet.action.reapplyBreakpointsAction",
    title: "Reapply All Breakpoints",
    enablement: "inDebugMode",
    menus: [rowMenuItem(MenuId.DebugBreakpointsContext, "z_commands", 30, BREAKPOINTS_ROW)],
    run(accessor) {
        return accessor.get(DebugServiceDIToken).setBreakpointsActivated(true);
    },
};

export const toggleBreakpointsPresentationAction: CommandAction = {
    id: "workbench.debug.viewlet.action.toggleBreakpointsPresentation",
    title: "Toggle Breakpoints View Presentation",
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: 10,
            icon: codicon("debug-alt"),
            visible: viewMenuVisible(BREAKPOINTS_VIEW_ID),
        },
    ],
    async run(accessor) {
        const configuration = accessor.get(IConfigurationServiceDIToken);
        const currentPresentation = configuration.get("debug.breakpointsView.presentation");
        const newPresentation = currentPresentation === "tree" ? "list" : "tree";
        await configuration.updateValue("debug.breakpointsView.presentation", newPresentation);
    },
};

export const collapseLoadedScriptsAction: CommandAction = {
    id: "loadedScripts.collapse",
    title: "Collapse All",
    menus: [
        ...HIDDEN_FROM_PALETTE,
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: 30,
            icon: COLLAPSE_ICON,
            visible: viewMenuVisible(LOADED_SCRIPTS_VIEW_ID),
        },
    ],
    run(accessor) {
        accessor.get(DebugViewletComponentDIToken).loadedScripts?.collapseAll();
    },
};

export const DEBUG_VIEW_ACTIONS: readonly CommandAction[] = [
    showRunAndDebugAction,
    collapseVariablesAction,
    addWatchExpressionAction,
    removeAllWatchExpressionsAction,
    collapseWatchAction,
    copyAllWatchExpressionsAction,
    renameWatchExpressionAction,
    removeWatchExpressionAction,
    collapseCallStackAction,
    collapseLoadedScriptsAction,
    toggleBreakpointAction,
    removeFocusedBreakpointAction,
    removeBreakpointAction,
    openBreakpointToSideAction,
    addFunctionBreakpointAction,
    toggleBreakpointsActivatedAction,
    removeAllBreakpointsAction,
    enableAllBreakpointsAction,
    disableAllBreakpointsAction,
    reapplyBreakpointsAction,
    toggleBreakpointsPresentationAction,
];
