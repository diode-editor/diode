/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/variablesView.ts
// The commands of the VARIABLES and WATCH rows' menus with upstream's ids, titles, keys and `when`
// (`variablesView.ts`, `watchExpressionsView.ts`, `debugCommands.ts`, the menu items of `debug.contribution.ts`):
// Set Value, Copy Value, Copy as Expression, Add to Watch, Break on Value Read/Change/Access, Copy Expression. A
// command from a menu gets upstream's argument (`IVariablesContext` from VARIABLES, the row's element from WATCH),
// from a key the row under the cursor of the focused view; Copy Value copies that one row, upstream the selection.
// Not planned: View Binary Data (the memory view, a webview).

import { type CommandAction, HIDDEN_FROM_PALETTE } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { ClipboardDIToken } from "../../../../platform/clipboard/common/iClipboard.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../../platform/keybinding/common/keybindingResolver.ts";
import { DataBreakpointSetType, type IExpression, VARIABLES_VIEW_ID, WATCH_VIEW_ID } from "../common/debug.ts";
import { Expression, Variable } from "../common/debugModel.ts";

import { getDataBreakpointInfoResponse, getVariableInternalContext, rowMenuItem } from "./debugContextMenus.ts";
import { DebugServiceDIToken } from "./debugService.ts";
import { watchExpressionOf } from "./debugViewActions.ts";
import { DebugViewletComponentDIToken } from "./debugViewlet.ts";

export const SET_VARIABLE_ID = "debug.setVariable";
export const COPY_VALUE_ID = "workbench.debug.viewlet.action.copyValue";
export const COPY_EVALUATE_PATH_ID = "debug.copyEvaluatePath";
export const ADD_TO_WATCH_ID = "debug.addToWatchExpressions";
export const BREAK_WHEN_VALUE_CHANGES_ID = "debug.breakWhenValueChanges";
export const BREAK_WHEN_VALUE_IS_ACCESSED_ID = "debug.breakWhenValueIsAccessed";
export const BREAK_WHEN_VALUE_IS_READ_ID = "debug.breakWhenValueIsRead";
export const SET_EXPRESSION_COMMAND_ID = "debug.setWatchExpression";
export const COPY_WATCH_EXPRESSION_COMMAND_ID = "debug.copyWatchExpression";

const VARIABLES_MENU = MenuId.DebugVariablesContext;
const WATCH_MENU = MenuId.DebugWatchContext;
const EVALUATE_NAME_PRESENT = "variableEvaluateNamePresent";
const NOT_READONLY = "!variableIsReadonly";

/** Upstream's `IVariablesContext`: the argument of a VARIABLES row's items (`Variable.toJSON`). */
interface IVariablesContext {
    readonly variable: { readonly evaluateName?: string };
}

function isVariablesContext(arg: unknown): arg is IVariablesContext {
    return typeof (arg as Partial<IVariablesContext> | undefined)?.variable === "object";
}

export const setVariableAction: CommandAction = {
    id: SET_VARIABLE_ID,
    title: "Set Value",
    keybinding: {
        keys: parseKeybinding("f2"),
        when: "variablesFocused",
        weight: KeybindingWeight.WorkbenchContrib + 5,
    },
    menus: [
        ...HIDDEN_FROM_PALETTE,
        rowMenuItem(
            VARIABLES_MENU,
            "3_modification",
            10,
            `debugSetVariableSupported || (${EVALUATE_NAME_PRESENT} && debugSetExpressionSupported)`,
            NOT_READONLY,
        ),
    ],
    run(accessor, context) {
        // From the menu the row is the one whose menu was opened, from F2 the one under the cursor.
        const focused = accessor.get(DebugViewletComponentDIToken).variables.tree.focused;
        const variable = isVariablesContext(context) ? getVariableInternalContext() : focused;
        if (variable instanceof Variable) {
            accessor.get(DebugServiceDIToken).getViewModel().setSelectedExpression(variable, false);
        }
    },
};

/** The row under the cursor of the focused VARIABLES or WATCH view, with upstream's evaluation context. */
function focusedElement(accessor: ServiceAccessor): { element: IExpression | undefined; context: string } | undefined {
    const viewlet = accessor.get(DebugViewletComponentDIToken);
    const focusedView = accessor.get(ContextKeyServiceDIToken).get("focusedView");
    if (focusedView === WATCH_VIEW_ID) return { element: viewlet.watch.tree.focused, context: "watch" };
    if (focusedView === VARIABLES_VIEW_ID) {
        const element = viewlet.variables.tree.focused;
        return { element: element instanceof Variable ? element : undefined, context: "variables" };
    }
    return undefined;
}

export const copyValueAction: CommandAction = {
    id: COPY_VALUE_ID,
    title: "Copy Value",
    keybinding: {
        keys: parseKeybinding("mod+c"),
        when: `!expressionSelected && (focusedView == '${WATCH_VIEW_ID}' || focusedView == '${VARIABLES_VIEW_ID}')`,
        // Upstream's weight ties with the terminal's copy; the two never hold together, one less makes it explicit.
        weight: KeybindingWeight.WorkbenchContrib - 1,
    },
    menus: [
        ...HIDDEN_FROM_PALETTE,
        rowMenuItem(VARIABLES_MENU, "5_cutcopypaste", 10),
        rowMenuItem(
            WATCH_MENU,
            "3_modification",
            40,
            "watchItemType == 'expression' || watchItemType == 'variable'",
            "inDebugMode",
        ),
    ],
    async run(accessor, arg) {
        const debugService = accessor.get(DebugServiceDIToken);
        const clipboard = accessor.get(ClipboardDIToken);
        let elementContext: string;
        let element: IExpression | undefined;
        if (arg === undefined) {
            const focused = focusedElement(accessor);
            if (!focused) return;
            ({ element, context: elementContext } = focused);
        } else if (arg instanceof Variable || arg instanceof Expression) {
            elementContext = "watch";
            element = arg;
        } else {
            elementContext = "variables";
            element = getVariableInternalContext();
        }

        const stackFrame = debugService.getViewModel().focusedStackFrame;
        const session = debugService.getViewModel().focusedSession;
        if (!stackFrame || !session || !element) {
            return;
        }

        const evalContext = session.capabilities.supportsClipboardContext ? "clipboard" : elementContext;
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- upstream: an empty string is none too
        const toEvaluate = element instanceof Variable ? element.evaluateName || element.value : element.name;

        try {
            const evaluation = await session.evaluate(toEvaluate, stackFrame.frameId, evalContext);
            if (evaluation) await clipboard.writeText(evaluation.body.result);
        } catch {
            await clipboard.writeText(element.value);
        }
    },
};

export const copyEvaluatePathAction: CommandAction = {
    id: COPY_EVALUATE_PATH_ID,
    title: "Copy as Expression",
    menus: [
        ...HIDDEN_FROM_PALETTE,
        rowMenuItem(VARIABLES_MENU, "5_cutcopypaste", 20, EVALUATE_NAME_PRESENT),
        rowMenuItem(WATCH_MENU, "3_modification", 50, EVALUATE_NAME_PRESENT, "inDebugMode"),
    ],
    async run(accessor, context) {
        const evaluateName =
            context instanceof Variable ? context.evaluateName : (context as IVariablesContext).variable.evaluateName;
        await accessor.get(ClipboardDIToken).writeText(evaluateName ?? "");
    },
};

export const addToWatchAction: CommandAction = {
    id: ADD_TO_WATCH_ID,
    title: "Add to Watch",
    menus: [...HIDDEN_FROM_PALETTE, rowMenuItem(VARIABLES_MENU, "z_commands", 100, EVALUATE_NAME_PRESENT)],
    run(accessor, context) {
        accessor.get(DebugServiceDIToken).addWatchExpression((context as IVariablesContext).variable.evaluateName);
    },
};

/** Upstream's three Break on Value commands: a data breakpoint from the info of the row whose menu was opened. */
function breakWhenValueAction(
    id: string,
    title: string,
    order: number,
    key: string,
    accessType: "read" | "write" | "readWrite",
): CommandAction {
    return {
        id,
        title,
        menus: [
            ...HIDDEN_FROM_PALETTE,
            rowMenuItem(VARIABLES_MENU, "z_commands", order, key),
            rowMenuItem(WATCH_MENU, "z_commands", order, key),
        ],
        async run(accessor) {
            const info = getDataBreakpointInfoResponse();
            if (info) {
                await accessor.get(DebugServiceDIToken).addDataBreakpoint({
                    description: info.description,
                    src: { type: DataBreakpointSetType.Variable, dataId: info.dataId ?? "" },
                    canPersist: !!info.canPersist,
                    accessTypes: info.accessTypes,
                    accessType,
                });
            }
        },
    };
}

export const breakWhenValueIsReadAction = breakWhenValueAction(
    BREAK_WHEN_VALUE_IS_READ_ID,
    "Break on Value Read",
    200,
    "breakWhenValueIsReadSupported",
    "read",
);

export const breakWhenValueChangesAction = breakWhenValueAction(
    BREAK_WHEN_VALUE_CHANGES_ID,
    "Break on Value Change",
    210,
    "breakWhenValueChangesSupported",
    "write",
);

export const breakWhenValueIsAccessedAction = breakWhenValueAction(
    BREAK_WHEN_VALUE_IS_ACCESSED_ID,
    "Break on Value Access",
    220,
    "breakWhenValueIsAccessedSupported",
    "readWrite",
);

export const setWatchExpressionAction: CommandAction = {
    id: SET_EXPRESSION_COMMAND_ID,
    title: "Set Value",
    menus: [
        ...HIDDEN_FROM_PALETTE,
        rowMenuItem(
            WATCH_MENU,
            "3_modification",
            30,
            "(watchItemType == 'expression' && debugSetExpressionSupported) || " +
                "(watchItemType == 'variable' && debugSetVariableSupported)",
            NOT_READONLY,
        ),
    ],
    run(accessor, expression) {
        if (expression instanceof Expression || expression instanceof Variable) {
            accessor.get(DebugServiceDIToken).getViewModel().setSelectedExpression(expression, true);
        }
    },
};

export const copyWatchExpressionAction: CommandAction = {
    id: COPY_WATCH_EXPRESSION_COMMAND_ID,
    title: "Copy Expression",
    enablement: "watchExpressionsExist",
    keybinding: {
        keys: parseKeybinding("mod+alt+c"),
        when: `focusedView == '${WATCH_VIEW_ID}' && !expressionSelected`,
        weight: KeybindingWeight.WorkbenchContrib,
    },
    menus: [...HIDDEN_FROM_PALETTE, rowMenuItem(WATCH_MENU, "3_modification", 20, "watchItemType == 'expression'")],
    async run(accessor, value) {
        const expression = watchExpressionOf(accessor, value);
        if (expression) await accessor.get(ClipboardDIToken).writeText(expression.name);
    },
};

export const VARIABLES_ACTIONS: readonly CommandAction[] = [
    setVariableAction,
    copyValueAction,
    copyEvaluatePathAction,
    addToWatchAction,
    breakWhenValueIsReadAction,
    breakWhenValueChangesAction,
    breakWhenValueIsAccessedAction,
    setWatchExpressionAction,
    copyWatchExpressionAction,
];
