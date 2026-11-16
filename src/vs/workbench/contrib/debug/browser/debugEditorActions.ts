/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/debugEditorActions.ts
// Upstream's `ToggleBreakpointAction` (F9) on the active text editor. Deviations: no disassembly view; no Run menu
// (diode has no menu bar).

import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../../platform/keybinding/common/keybindingResolver.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";

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
