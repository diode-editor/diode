/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/debugEditorActions.ts
// Upstream's `ToggleBreakpointAction` (F9) and the actions that open the breakpoint widget (Add Conditional
// Breakpoint..., Add Logpoint..., Add Triggered Breakpoint..., Edit Breakpoint) on the active text editor. Deviations:
// no disassembly view; no Run menu (diode has no menu bar); Edit Breakpoint looks only at the editor's file (upstream
// takes the breakpoints of the cursor's line number in any file).

import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../../platform/keybinding/common/keybindingResolver.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";

import { BreakpointInputDIToken, BreakpointWidgetContext } from "./breakpointInput.ts";
import { DebugServiceDIToken } from "./debugService.ts";

export const TOGGLE_BREAKPOINT_ID = "editor.debug.action.toggleBreakpoint";

export const toggleEditorBreakpointAction: CommandAction = {
    id: TOGGLE_BREAKPOINT_ID,
    title: "Debug: Toggle Breakpoint",
    keybinding: { keys: parseKeybinding("f9"), when: "editorTextFocus", weight: KeybindingWeight.EditorContrib },
    enablement: "debuggersAvailable",
    async run(accessor) {
        const debugService = accessor.get(DebugServiceDIToken);
        const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
        if (!editor) return;
        const modelUri = editor.uri;
        const canSet = debugService.canSetBreakpointsIn(editor.languageId);
        // Does not account for multi line selections, Set to remove multiple cursor on the same line
        const lineNumbers = [...new Set(editor.viewState.selections.map((s) => s.active.line + 1))];

        await Promise.all(
            lineNumbers.map(async (line) => {
                const bps = debugService.getModel().getBreakpoints({ lineNumber: line, uri: modelUri });
                if (bps.length) {
                    await Promise.all(bps.map((bp) => debugService.removeBreakpoints(bp.getId())));
                } else if (canSet) {
                    await debugService.addBreakpoints(modelUri, [{ lineNumber: line }]);
                }
            }),
        );
    },
};

/** Upstream's actions that open the widget of a kind at the cursor: the line, and the column for some. */
function showBreakpointWidgetAction(
    id: string,
    title: string,
    context: BreakpointWidgetContext,
    atColumn: boolean,
): CommandAction {
    return {
        id,
        title,
        enablement: "debuggersAvailable",
        async run(accessor) {
            const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
            if (!editor || !accessor.get(DebugServiceDIToken).canSetBreakpointsIn(editor.languageId)) return;
            const column = atColumn ? editor.primaryCursorColumn + 1 : undefined;
            await accessor.get(BreakpointInputDIToken).show(editor.uri, editor.primaryCursorLine + 1, column, context);
        },
    };
}

export const conditionalBreakpointAction = showBreakpointWidgetAction(
    "editor.debug.action.conditionalBreakpoint",
    "Debug: Add Conditional Breakpoint...",
    BreakpointWidgetContext.CONDITION,
    false,
);

export const addLogPointAction = showBreakpointWidgetAction(
    "editor.debug.action.addLogPoint",
    "Debug: Add Logpoint...",
    BreakpointWidgetContext.LOG_MESSAGE,
    true,
);

export const triggerByBreakpointAction = showBreakpointWidgetAction(
    "editor.debug.action.triggerByBreakpoint",
    "Debug: Add Triggered Breakpoint...",
    BreakpointWidgetContext.TRIGGER_POINT,
    true,
);

/** Upstream `EditBreakpointAction`: the widget of the breakpoint of the cursor's line closest to the cursor. */
export const editBreakpointAction: CommandAction = {
    id: "editor.debug.action.editBreakpoint",
    title: "Debug: Edit Breakpoint",
    enablement: "debuggersAvailable",
    async run(accessor) {
        const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
        if (!editor) return;
        const lineNumber = editor.primaryCursorLine + 1;
        const column = editor.primaryCursorColumn + 1;
        const lineBreakpoints = accessor
            .get(DebugServiceDIToken)
            .getModel()
            .getBreakpoints({ lineNumber, uri: editor.uri });
        if (lineBreakpoints.length === 0) return;
        const breakpointDistances = lineBreakpoints.map((b) => (b.column ? Math.abs(b.column - column) : column));
        const closestBreakpoint = lineBreakpoints[breakpointDistances.indexOf(Math.min(...breakpointDistances))];
        await accessor
            .get(BreakpointInputDIToken)
            .show(editor.uri, closestBreakpoint.lineNumber, closestBreakpoint.column);
    },
};

export const BREAKPOINT_EDITOR_ACTIONS: readonly CommandAction[] = [
    toggleEditorBreakpointAction,
    conditionalBreakpointAction,
    addLogPointAction,
    triggerByBreakpointAction,
    editBreakpointAction,
];
