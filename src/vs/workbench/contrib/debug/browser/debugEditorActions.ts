/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/debugEditorActions.ts
// Upstream's `ToggleBreakpointAction` (F9) and `ShowDebugHoverAction` (Ctrl+K Ctrl+I) on the active text editor, with
// the hover half of `DebugEditorContribution.showHover`: the debug hover over the focused frame's file, the language
// hover elsewhere and where the debugger has no value. Deviations: no disassembly view; no Run menu (diode has no menu
// bar).

import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../../platform/keybinding/common/keybindingResolver.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { HoverServiceDIToken } from "../../hover/browser/hoverService.ts";

import { DebugHoverWidgetDIToken, ShowDebugHoverResult } from "./debugHover.ts";
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

/**
 * Upstream's Ctrl+K Ctrl+I, in debug mode only, so outside it Add Cursors to Line Ends keeps the chord. On a legacy
 * terminal Ctrl+I arrives as Tab: the same keys there are Ctrl+K Tab (the language hover is Ctrl+K Ctrl+U for the
 * same reason, see docs/arch/workbench/Commands.md#коллизии-дефолтов).
 */
export const showDebugHoverAction: CommandAction = {
    id: "editor.debug.action.showDebugHover",
    title: "Debug: Show Hover",
    keybindings: [
        { keys: parseChord("ctrl+k ctrl+i"), when: "editorTextFocus", weight: KeybindingWeight.EditorContrib },
        { keys: parseChord("ctrl+k tab"), when: "editorTextFocus", weight: KeybindingWeight.EditorContrib },
    ],
    enablement: "inDebugMode",
    async run(accessor) {
        const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
        if (!editor) return;
        const sf = accessor.get(DebugServiceDIToken).getViewModel().focusedStackFrame;
        if (sf?.source.uri.toString() === editor.uri.toString()) {
            const position = editor.viewState.selections[0].active;
            const { document } = editor.model;
            const target = {
                uri: editor.uri,
                languageId: editor.languageId,
                versionId: document.versionId,
                getLineContent: (line: number) => document.getLineContent(line),
                getCaretAnchor: () => editor.getCaretAnchor(),
            };
            const result = await accessor.get(DebugHoverWidgetDIToken).showAt(target, position, sf);
            // When no expression available fallback to editor hover
            if (result !== ShowDebugHoverResult.NOT_AVAILABLE) return;
        }
        await accessor.get(HoverServiceDIToken).showHover();
    },
};
