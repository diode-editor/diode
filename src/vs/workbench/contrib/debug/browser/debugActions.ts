import { codicon, type IProductIcon } from "../../../../base/common/codicons.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { containerMenuVisible, viewMenuVisible } from "../../../browser/actions/menuContexts.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { DebugStubModelDIToken } from "../common/debugStubModel.ts";

import {
    BREAKPOINTS_VIEW_ID,
    DEBUG_VIEWLET_ID,
    DebugViewsComponentDIToken,
    VARIABLES_VIEW_ID,
    WATCH_VIEW_ID,
} from "./debugViews.ts";
import { REPL_VIEW_ID, ReplComponentDIToken } from "./replView.ts";

/**
 * SPIKE: upstream's debug commands (`debugCommands.ts`, `debugActionViewItems.ts`) over the fake session. The
 * toolbar is docked into the Run and Debug viewlet's title (upstream `debug.toolBarLocation: docked`): a terminal
 * has no floating toolbar.
 */

function icon(name: string, fallback: string): IProductIcon {
    const base = codicon(name);
    return { nerdFont: base.nerdFont, unicode: base.unicode === "" ? fallback : base.unicode };
}

const STOPPED = "debugState == 'stopped'";
const RUNNING = "debugState == 'running'";
const IN_DEBUG = "inDebugMode";

const inToolbar = (order: number, glyph: IProductIcon, when: string) =>
    ({
        menuId: MenuId.ViewContainerTitle,
        group: "navigation",
        order,
        icon: glyph,
        visible: containerMenuVisible(DEBUG_VIEWLET_ID),
        when,
    }) as const;

export const startDebuggingAction: CommandAction = {
    id: "workbench.action.debug.start",
    title: "Debug: Start Debugging",
    shortTitle: "Start Debugging",
    keybinding: { keys: parseKeybinding("f5"), when: `!${IN_DEBUG}` },
    menus: [inToolbar(10, icon("debug-alt", "▶"), `!${IN_DEBUG}`)],
    run(accessor) {
        accessor.get(DebugStubModelDIToken).start();
    },
};

export const continueAction: CommandAction = {
    id: "workbench.action.debug.continue",
    title: "Debug: Continue",
    shortTitle: "Continue",
    keybinding: { keys: parseKeybinding("f5"), when: STOPPED },
    menus: [inToolbar(10, icon("debug-continue", "▶"), STOPPED)],
    run(accessor) {
        accessor.get(DebugStubModelDIToken).continue();
    },
};

export const pauseAction: CommandAction = {
    id: "workbench.action.debug.pause",
    title: "Debug: Pause",
    shortTitle: "Pause",
    keybinding: { keys: parseKeybinding("f6"), when: RUNNING },
    menus: [inToolbar(10, icon("debug-pause", "‖"), RUNNING)],
    run(accessor) {
        accessor.get(DebugStubModelDIToken).pause();
    },
};

export const stepOverAction: CommandAction = {
    id: "workbench.action.debug.stepOver",
    title: "Debug: Step Over",
    shortTitle: "Step Over",
    keybinding: { keys: parseKeybinding("f10"), when: STOPPED },
    menus: [inToolbar(20, icon("debug-step-over", "↷"), IN_DEBUG)],
    enablement: STOPPED,
    run(accessor) {
        accessor.get(DebugStubModelDIToken).step("over");
    },
};

export const stepIntoAction: CommandAction = {
    id: "workbench.action.debug.stepInto",
    title: "Debug: Step Into",
    shortTitle: "Step Into",
    keybinding: { keys: parseKeybinding("f11"), when: STOPPED },
    menus: [inToolbar(30, icon("debug-step-into", "↓"), IN_DEBUG)],
    enablement: STOPPED,
    run(accessor) {
        accessor.get(DebugStubModelDIToken).step("into");
    },
};

export const stepOutAction: CommandAction = {
    id: "workbench.action.debug.stepOut",
    title: "Debug: Step Out",
    shortTitle: "Step Out",
    keybinding: { keys: parseKeybinding("shift+f11"), when: STOPPED },
    menus: [inToolbar(40, icon("debug-step-out", "↑"), IN_DEBUG)],
    enablement: STOPPED,
    run(accessor) {
        accessor.get(DebugStubModelDIToken).step("out");
    },
};

export const restartAction: CommandAction = {
    id: "workbench.action.debug.restart",
    title: "Debug: Restart",
    shortTitle: "Restart",
    keybinding: { keys: parseKeybinding("ctrl+shift+f5"), when: IN_DEBUG },
    menus: [inToolbar(50, icon("debug-restart", "↻"), IN_DEBUG)],
    run(accessor) {
        accessor.get(DebugStubModelDIToken).restart();
    },
};

export const stopAction: CommandAction = {
    id: "workbench.action.debug.stop",
    title: "Debug: Stop",
    shortTitle: "Stop",
    keybinding: { keys: parseKeybinding("shift+f5"), when: IN_DEBUG },
    menus: [inToolbar(60, icon("debug-stop", "■"), IN_DEBUG)],
    run(accessor) {
        accessor.get(DebugStubModelDIToken).terminate();
    },
};

export const showRunAndDebugAction: CommandAction = {
    id: "workbench.view.debug",
    title: "View: Show Run and Debug",
    keybinding: parseKeybinding("ctrl+shift+d"),
    run(accessor) {
        accessor.get(ViewsServiceDIToken).openViewContainer(DEBUG_VIEWLET_ID, true);
    },
};

export const toggleReplAction: CommandAction = {
    id: "workbench.debug.action.toggleRepl",
    title: "View: Toggle Debug Console",
    keybinding: parseKeybinding("ctrl+shift+y"),
    run(accessor) {
        const views = accessor.get(ViewsServiceDIToken);
        if (views.isViewShown(REPL_VIEW_ID)) views.closeView(REPL_VIEW_ID);
        else views.openView(REPL_VIEW_ID, true);
    },
};

export const clearReplAction: CommandAction = {
    id: "workbench.debug.panel.action.clearReplAction",
    title: "Debug: Clear Console",
    shortTitle: "Clear Console",
    keybinding: { keys: parseKeybinding("ctrl+l"), when: `focusedView == '${REPL_VIEW_ID}'` },
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: 30,
            icon: codicon("clear-all"),
            visible: viewMenuVisible(REPL_VIEW_ID),
        },
    ],
    run(accessor) {
        accessor.get(ReplComponentDIToken).clear();
    },
};

export const addWatchExpressionAction: CommandAction = {
    id: "workbench.debug.viewlet.action.addWatchExpression",
    title: "Debug: Add Expression",
    shortTitle: "Add Expression",
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: 10,
            icon: codicon("add"),
            visible: viewMenuVisible(WATCH_VIEW_ID),
        },
    ],
    async run(accessor) {
        const expression = await accessor.get(QuickInputServiceDIToken).input({
            prompt: "Expression to watch",
            placeholder: "e.g. nums[i], p.x, total / count",
        });
        if (expression === undefined || expression.trim() === "") return;
        await accessor.get(DebugViewsComponentDIToken).addWatchExpression(expression.trim());
    },
};

export const removeAllWatchExpressionsAction: CommandAction = {
    id: "workbench.debug.viewlet.action.removeAllWatchExpressions",
    title: "Debug: Remove All Expressions",
    shortTitle: "Remove All Expressions",
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: 30,
            icon: codicon("close-all"),
            visible: viewMenuVisible(WATCH_VIEW_ID),
        },
    ],
    run(accessor) {
        accessor.get(DebugStubModelDIToken).removeAllWatches();
    },
};

export const collapseVariablesAction: CommandAction = {
    id: "workbench.debug.viewlet.action.collapseVariables",
    title: "Debug: Collapse All Variables",
    shortTitle: "Collapse All",
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: 30,
            icon: codicon("collapse-all"),
            visible: viewMenuVisible(VARIABLES_VIEW_ID),
        },
    ],
    run(accessor) {
        accessor.get(DebugViewsComponentDIToken).variables.collapseAll();
    },
};

export const addFunctionBreakpointAction: CommandAction = {
    id: "workbench.debug.viewlet.action.addFunctionBreakpointAction",
    title: "Debug: Add Function Breakpoint",
    shortTitle: "Add Function Breakpoint",
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
        const name = await accessor.get(QuickInputServiceDIToken).input({
            prompt: "Function to break on",
            placeholder: "e.g. accumulate",
        });
        if (name === undefined || name.trim() === "") return;
        accessor.get(DebugStubModelDIToken).addFunctionBreakpoint(name.trim());
    },
};

export const removeAllBreakpointsAction: CommandAction = {
    id: "workbench.debug.viewlet.action.removeAllBreakpoints",
    title: "Debug: Remove All Breakpoints",
    shortTitle: "Remove All Breakpoints",
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: 30,
            icon: codicon("close-all"),
            visible: viewMenuVisible(BREAKPOINTS_VIEW_ID),
        },
    ],
    run(accessor) {
        accessor.get(DebugStubModelDIToken).removeAllBreakpoints();
    },
};

export const DEBUG_ACTIONS: readonly CommandAction[] = [
    startDebuggingAction,
    continueAction,
    pauseAction,
    stepOverAction,
    stepIntoAction,
    stepOutAction,
    restartAction,
    stopAction,
    showRunAndDebugAction,
    toggleReplAction,
    clearReplAction,
    addWatchExpressionAction,
    removeAllWatchExpressionsAction,
    collapseVariablesAction,
    addFunctionBreakpointAction,
    removeAllBreakpointsAction,
];
