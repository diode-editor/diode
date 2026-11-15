// The commands of the Run and Debug viewlet with upstream's ids, titles, keys and `when`: showing it
// (`debug.contribution.ts`), Collapse All of VARIABLES (`variablesView.ts`), the WATCH title and keys
// (`watchExpressionsView.ts`, `debugCommands.ts`). Deviation: Ctrl+Shift+D reaches only terminals with extended keys;
// Ctrl+K B shows the viewlet everywhere (Ctrl+K D, the free letter of the other viewlets, is Compare with Saved).

import { codicon } from "../../../../base/common/codicons.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { ClipboardDIToken } from "../../../../platform/clipboard/common/iClipboard.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../../platform/keybinding/common/keybindingResolver.ts";
import { viewMenuVisible } from "../../../browser/actions/menuContexts.ts";
import { SidebarServiceDIToken } from "../../../browser/parts/sidebar/sidebarService.ts";
import { VARIABLES_VIEW_ID, VIEWLET_ID, WATCH_VIEW_ID } from "../common/debug.ts";
import { Expression } from "../common/debugModel.ts";

import { DebugServiceDIToken } from "./debugService.ts";
import { DebugViewletComponentDIToken } from "./debugViewlet.ts";

export const ADD_WATCH_ID = "workbench.debug.viewlet.action.addWatchExpression";
export const REMOVE_WATCH_EXPRESSIONS_COMMAND_ID = "workbench.debug.viewlet.action.removeAllWatchExpressions";
export const COPY_ALL_WATCH_EXPRESSIONS_COMMAND_ID = "workbench.debug.viewlet.action.copyAllWatchExpressions";
export const EDIT_EXPRESSION_COMMAND_ID = "debug.renameWatchExpression";
export const REMOVE_EXPRESSION_COMMAND_ID = "debug.removeWatchExpression";

const COLLAPSE_ICON = codicon("collapse-all");
const HIDDEN_FROM_PALETTE = [{ menuId: MenuId.CommandPalette, when: "false" }] as const;

/** The expression a WATCH command acts on: its argument (a row of a menu), else the focused row of the view. */
function watchExpressionOf(accessor: ServiceAccessor, arg: unknown): Expression | undefined {
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
    menus: HIDDEN_FROM_PALETTE,
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
    menus: HIDDEN_FROM_PALETTE,
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
        // Upstream's WorkbenchContrib ties with Kill Terminal's Delete, which upstream settles by registration order;
        // the contexts never meet, one more makes the order explicit.
        weight: KeybindingWeight.WorkbenchContrib + 1,
    },
    menus: HIDDEN_FROM_PALETTE,
    run(accessor, expression) {
        const target = watchExpressionOf(accessor, expression);
        if (target) accessor.get(DebugServiceDIToken).removeWatchExpressions(target.getId());
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
];
