/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/variablesView.ts
// The context menus of the debug views' rows: the keys of the row on top of the global ones (upstream's overlay
// context key services of `variablesView.ts`, `watchExpressionsView.ts`, `callStackView.ts`, `breakpointsView.ts`,
// `common/debugContext.ts`) and a popup of the menu without its `inline` group whose items run with the row's
// arguments, built-in and extension ones alike. As upstream, the variable whose menu is open and its data breakpoint
// info are kept here for the commands that take no element (`debug.setVariable`, `debug.breakWhenValue*`).

import type { OverlayAnchorPosition } from "@tuidom/core/dom/overlayLayer";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";

import { onUnexpectedError } from "../../../../base/common/errors.ts";
import type { CommandMenuPlacement } from "../../../../platform/actions/common/commandAction.ts";
import type { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { joinMenuGroups, type MenuContextKeys } from "../../../../platform/actions/common/menuRegistry.ts";
import type { MenuService } from "../../../../platform/actions/common/menuService.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { bindMenuEntry, INLINE_MENU_GROUP, runMenuEntry } from "../../../browser/parts/views/treeItemMenu.ts";
import {
    DataBreakpointSetType,
    type IDataBreakpointInfoResponse,
    type IDebugService,
    type IExpression,
    type IStackFrame,
    State,
} from "../common/debug.ts";
import {
    Breakpoint,
    DataBreakpoint,
    ExceptionBreakpoint,
    Expression,
    FunctionBreakpoint,
    InstructionBreakpoint,
    StackFrame,
    Thread,
    Variable,
} from "../common/debugModel.ts";
import { isSessionAttach } from "../common/debugUtils.ts";

import { isDebugSession } from "./callStackView.ts";

export interface IDebugContextMenuHost {
    readonly menus: Pick<MenuService, "getEntryGroups">;
    readonly contextMenu: Pick<ContextMenuService, "showContextMenu">;
    readonly commands: Pick<CommandRegistry, "execute">;
}

export interface IDebugContextMenuRequest {
    readonly owner: TUIElement;
    readonly anchor: OverlayAnchorPosition;
    readonly menuId: MenuId;
    readonly keys: MenuContextKeys;
    /** Upstream's `arg` (and the forwarded actions context of the call stack): every item runs with them. */
    readonly args: readonly unknown[];
}

/** Upstream `registerDebugViewMenuItem` and the `menu` of the views' actions: an item of a row's context menu. */
export function rowMenuItem(
    menuId: MenuId,
    group: string,
    order: number,
    when?: string,
    enablement?: string,
): CommandMenuPlacement {
    return { menuId, group, order, when, enablement };
}

/** Upstream `getContextMenuActions(menu, 'inline').secondary`: no items, no menu. */
export function showDebugContextMenu(host: IDebugContextMenuHost, request: IDebugContextMenuRequest): void {
    const groups = host.menus
        .getEntryGroups(request.menuId, undefined, request.keys)
        .filter((group) => group.group !== INLINE_MENU_GROUP);
    const entries = joinMenuGroups(groups).map((entry) =>
        bindMenuEntry(entry, (item) => {
            runMenuEntry(
                item,
                (id) => host.commands.execute(id, ...request.args),
                (message) => {
                    onUnexpectedError(new Error(message));
                },
            );
        }),
    );
    host.contextMenu.showContextMenu({
        getOwner: () => request.owner,
        getAnchor: () => request.anchor,
        getEntries: () => entries,
    });
}

let variableInternalContext: Variable | undefined;
let dataBreakpointInfoResponse: IDataBreakpointInfoResponse | undefined;

/** The variable whose menu was opened last (upstream's `variableInternalContext`). */
export function getVariableInternalContext(): Variable | undefined {
    return variableInternalContext;
}

/** The data breakpoint info of the element whose menu was opened last. */
export function getDataBreakpointInfoResponse(): IDataBreakpointInfoResponse | undefined {
    return dataBreakpointInfoResponse;
}

/** Upstream `getContextForVariable`. */
function variableKeys(variable: Variable): MenuContextKeys {
    const session = variable.getSession();
    return {
        debugProtocolVariableMenuContext: variable.variableMenuContext ?? "",
        variableEvaluateNamePresent: !!variable.evaluateName,
        canViewMemory: !!session?.capabilities.supportsReadMemoryRequest && variable.memoryReference !== undefined,
        variableIsReadonly: isReadonly(variable),
        variableType: variable.type ?? "",
        debugType: session?.configuration.type ?? "",
    };
}

function isReadonly(expression: IExpression): boolean {
    return !!expression.presentationHint?.attributes?.includes("readOnly") || !!expression.presentationHint?.lazy;
}

/** Upstream's `breakWhenValue*Supported` of a data breakpoint info: the access types it offers, else a change. */
function dataAccessKeys(response: IDataBreakpointInfoResponse | undefined): MenuContextKeys {
    const supported = !!response?.dataId;
    if (!response?.accessTypes) return { breakWhenValueChangesSupported: supported };
    const keys: Record<string, boolean> = {};
    for (const accessType of response.accessTypes) {
        if (accessType === "read") keys.breakWhenValueIsReadSupported = supported;
        else if (accessType === "write") keys.breakWhenValueChangesSupported = supported;
        else keys.breakWhenValueIsAccessedSupported = supported;
    }
    return keys;
}

/**
 * Upstream `getContextForVariableMenuWithDataAccess`: asks the adapter whether the variable can be watched.
 * Deviation: a failed request leaves the items out, as WATCH does, instead of the whole menu.
 */
export async function variableMenuKeys(variable: Variable): Promise<MenuContextKeys> {
    variableInternalContext = variable;
    const session = variable.getSession();
    dataBreakpointInfoResponse = undefined;
    if (!session?.capabilities.supportsDataBreakpoints) return variableKeys(variable);
    const response = await session.dataBreakpointInfo(variable.name, variable.parent.reference).catch(() => undefined);
    dataBreakpointInfoResponse = response;
    return { ...variableKeys(variable), ...dataAccessKeys(response) };
}

/** Upstream `getContextForWatchExpressionMenu`. */
function watchKeys(expression: IExpression): MenuContextKeys {
    const session = expression.getSession();
    return {
        variableEvaluateNamePresent: "evaluateName" in expression,
        watchItemType: watchItemType(expression),
        canViewMemory: !!session?.capabilities.supportsReadMemoryRequest && expression.memoryReference !== undefined,
        variableIsReadonly: isReadonly(expression),
        variableType: expression.type ?? "",
        debugType: session?.configuration.type ?? "",
    };
}

/**
 * Upstream `getContextForWatchExpressionMenuWithDataAccess`: the evaluate name when there is one, else the name
 * within the parent for a variable, else the name as an expression. A failed request leaves the items out.
 */
export async function watchMenuKeys(
    expression: IExpression,
    stackFrame: IStackFrame | undefined,
): Promise<MenuContextKeys> {
    const session = expression.getSession();
    dataBreakpointInfoResponse = undefined;
    if (!session?.capabilities.supportsDataBreakpoints) return watchKeys(expression);
    let response: IDataBreakpointInfoResponse | undefined;
    try {
        if (expression instanceof Variable && expression.evaluateName) {
            response = await session.dataBreakpointInfo(expression.evaluateName, undefined, stackFrame?.frameId);
        } else if (expression instanceof Variable) {
            response = await session.dataBreakpointInfo(
                expression.name,
                expression.parent.reference,
                stackFrame?.frameId,
            );
        } else {
            response = await session.dataBreakpointInfo(expression.name, undefined, stackFrame?.frameId);
        }
    } catch {
        // silently continue without data breakpoint support for this item
    }
    dataBreakpointInfoResponse = response;
    return { ...watchKeys(expression), ...dataAccessKeys(response) };
}

/** Upstream's session, thread and stack frame overlays of a call stack row; other rows clear the type. */
export function callStackItemKeys(item: unknown): MenuContextKeys {
    if (isDebugSession(item)) {
        return {
            callStackItemType: "session",
            callStackSessionIsAttach: isSessionAttach(item),
            callStackItemStopped: item.state === State.Stopped,
            callStackSessionHasOneThread: item.getAllThreads().length === 1,
        };
    }
    if (item instanceof Thread) return { callStackItemType: "thread", callStackItemStopped: item.stopped };
    if (item instanceof StackFrame) {
        return { callStackItemType: "stackFrame", stackFrameSupportsRestart: item.canRestart };
    }
    return { callStackItemType: "" };
}

/** Upstream's `watchItemType` of a WATCH row. */
export function watchItemType(element: IExpression | undefined): string {
    if (element === undefined) return "";
    return element instanceof Expression ? "expression" : "variable";
}

/** Upstream `getModeKindForBreakpoint`: the kind of the modes a breakpoint picks from. */
export function getModeKindForBreakpoint(breakpoint: unknown): "source" | "instruction" | "exception" {
    return breakpoint instanceof Breakpoint
        ? "source"
        : breakpoint instanceof InstructionBreakpoint
          ? "instruction"
          : "exception";
}

/**
 * Upstream's overlay keys of a breakpoints row (`onTreeContextMenu`): its type, whether it takes a condition (an
 * exception filter by its own word, the others by the focused session's), whether it is a data breakpoint on a range
 * of memory, and whether there is more than one mode to switch to.
 */
export function breakpointItemKeys(element: unknown, debugService: IDebugService): MenuContextKeys {
    const session = debugService.getViewModel().focusedSession;
    const conditionSupported =
        element instanceof ExceptionBreakpoint
            ? element.supportsCondition
            : !session || !!session.capabilities.supportsConditionalBreakpoints;
    return {
        breakpointItemType: breakpointItemType(element),
        breakpointSupportsCondition: conditionSupported,
        breakpointItemBytes: element instanceof DataBreakpoint && element.src.type === DataBreakpointSetType.Address,
        breakpointHasModes: debugService.getModel().getBreakpointModes(getModeKindForBreakpoint(element)).length > 1,
    };
}

/** Upstream's `breakpointItemType` of a breakpoints row. */
export function breakpointItemType(element: unknown): string {
    if (element instanceof Breakpoint) return "breakpoint";
    if (element instanceof ExceptionBreakpoint) return "exceptionBreakpoint";
    if (element instanceof FunctionBreakpoint) return "functionBreakpoint";
    if (element instanceof DataBreakpoint) return "dataBreakpoint";
    if (element instanceof InstructionBreakpoint) return "instructionBreakpoint";
    return element === undefined ? "" : "breakpointFolder";
}
