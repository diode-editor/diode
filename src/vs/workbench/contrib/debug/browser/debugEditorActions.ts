/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/debugEditorActions.ts
// Upstream's `ToggleBreakpointAction` (F9), the actions that open the breakpoint widget (Add Conditional
// Breakpoint..., Add Logpoint..., Add Triggered Breakpoint..., Edit Breakpoint), Run to Cursor, Step Into Target,
// Evaluate in Debug Console, Add to Watch, Go to Next/Previous Breakpoint and Close Exception Widget on the active text
// editor, with the editor's commands of `debugCommands.ts`: Jump to Cursor, Step Into Target (Ctrl+F11) and the inline
// breakpoint (Shift+F9); their items of the editor's context menu (group `debug`). Deviations: no disassembly view;
// no Run menu (diode has no menu bar); Edit Breakpoint looks only at the editor's file (upstream takes the breakpoints
// of the cursor's line number in any file); the step targets of the editor's Step Into Target are a quick pick
// (upstream: a context menu at the cursor) and "Step targets are not available here" is a notification (upstream: a
// message over the cursor); Add to Watch without a selection takes the expression around the cursor by upstream's
// regular expression (no language's evaluatable expression provider yet); Ctrl+F11 previews a target's range only
// when the active editor shows the frame's file (upstream opens it); Close Exception Widget's Escape also wants the
// editor's focus (upstream's context key is the editor's own). Not here yet: Debug: Show Hover (the hover).

import { comparePositions, createPosition, type IPosition } from "../../../../editor/common/core/iPosition.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createSelection } from "../../../../editor/common/core/iSelection.ts";
import type { CommandAction, CommandMenuPlacement } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../../platform/keybinding/common/keybindingResolver.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { NotificationServiceDIToken } from "../../../services/notification/browser/notificationService.ts";
import { REPL_VIEW_ID, WATCH_VIEW_ID } from "../common/debug.ts";
import { getExactExpressionStartAndEnd } from "../common/debugUtils.ts";

import { BreakpointInputDIToken, BreakpointWidgetContext } from "./breakpointInput.ts";
import { BreakpointSourcesDIToken } from "./breakpointsView.ts";
import { DebugEditorContributionDIToken } from "./debugEditorContribution.ts";
import { DebugServiceDIToken } from "./debugService.ts";
import { ReplDIToken } from "./repl.ts";

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

export const RUN_TO_CURSOR_ID = "editor.debug.action.runToCursor";
export const JUMP_TO_CURSOR_ID = "debug.jumpToCursor";
export const STEP_INTO_TARGETS_ID = "editor.debug.action.stepIntoTargets";
export const STEP_INTO_TARGET_ID = "workbench.action.debug.stepIntoTarget";
export const SELECTION_TO_REPL_ID = "editor.debug.action.selectionToRepl";
export const SELECTION_TO_WATCH_ID = "editor.debug.action.selectionToWatch";
export const GO_TO_NEXT_BREAKPOINT_ID = "editor.debug.action.goToNextBreakpoint";
export const GO_TO_PREVIOUS_BREAKPOINT_ID = "editor.debug.action.goToPreviousBreakpoint";
export const TOGGLE_INLINE_BREAKPOINT_ID = "editor.debug.action.toggleInlineBreakpoint";
export const CLOSE_EXCEPTION_WIDGET_ID = "editor.debug.action.closeExceptionWidget";

const IN_DEBUG_MODE = "inDebugMode";
const STEP_INTO_TARGETS_WHEN = `stepIntoTargetsSupported && ${IN_DEBUG_MODE} && debugState == 'stopped'`;

/** Upstream `EditorAction.contextMenuOpts`: an item of the editor's context menu (group `debug`) while `when` holds. */
function editorContextItem(order: number, when: string, title?: string): CommandMenuPlacement {
    return { menuId: MenuId.EditorContext, group: "debug", order, when, title };
}

function notify(accessor: ServiceAccessor, severity: "info" | "warn", message: string): void {
    accessor.get(NotificationServiceDIToken).show({ severity, message, modal: false, items: [] });
}

/**
 * Upstream `RunToCursorAction`: the program runs to the cursor's line; on the line the focused frame is paused on, to
 * the cursor's column (#102199).
 */
export const runToCursorAction: CommandAction = {
    id: RUN_TO_CURSOR_ID,
    title: "Run to Cursor",
    enablement: "debuggersAvailable",
    menus: [editorContextItem(2, `debuggersAvailable && ${IN_DEBUG_MODE}`)],
    async run(accessor) {
        const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
        if (!editor) return;
        const debugService = accessor.get(DebugServiceDIToken);
        const lineNumber = editor.primaryCursorLine + 1;
        const focusedStackFrame = debugService.getViewModel().focusedStackFrame;
        // If the cursor is on a line different than the one the debugger is currently paused on, then send the
        // breakpoint on the line without a column otherwise set it at the precise column #102199
        const onFocusedLine =
            focusedStackFrame?.source.uri.toString() === editor.uri.toString() &&
            focusedStackFrame.range.startLineNumber === lineNumber;
        await debugService.runTo(editor.uri, lineNumber, onFocusedLine ? editor.primaryCursorColumn + 1 : undefined);
    },
};

/** Upstream `JUMP_TO_CURSOR_ID`: the focused thread goes on from the cursor, a location picked when there are more. */
export const jumpToCursorAction: CommandAction = {
    id: JUMP_TO_CURSOR_ID,
    title: "Debug: Jump to Cursor",
    menus: [
        { menuId: MenuId.CommandPalette, when: "debuggersAvailable && jumpToCursorSupported" },
        {
            menuId: MenuId.CommandPalette,
            when: "debuggersAvailable && jumpToCursorSupported",
            title: "Debug: Set Next Statement",
        },
        editorContextItem(3, "jumpToCursorSupported", "Jump to Cursor"),
    ],
    async run(accessor) {
        const stackFrame = accessor.get(DebugServiceDIToken).getViewModel().focusedStackFrame;
        const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
        const session = stackFrame?.thread.session;
        const source = editor ? session?.getSourceForUri(editor.uri) : undefined;
        if (stackFrame && editor && session && source) {
            const response = await session.gotoTargets(
                source.raw,
                editor.primaryCursorLine + 1,
                editor.primaryCursorColumn + 1,
            );
            const targets = response?.body.targets;
            if (targets?.length) {
                let id = targets[0].id;
                if (targets.length > 1) {
                    const picks = targets.map((t) => ({ label: t.label, id: t.id }));
                    const pick = (await accessor
                        .get(QuickInputServiceDIToken)
                        .quickPick({ placeholder: "Choose the specific location", items: picks })) as
                        | (typeof picks)[number]
                        | undefined;
                    if (!pick) return;
                    id = pick.id;
                }
                await session.goto(stackFrame.thread.threadId, id).catch((e: unknown) => {
                    notify(accessor, "warn", (e as Error).message);
                });
                return;
            }
        }
        notify(accessor, "warn", "No executable code is associated at the current cursor position.");
    },
};

const NO_TARGETS_MESSAGE = "Step targets are not available here";

interface IPositionalTarget {
    readonly start: IPosition;
    readonly end: IPosition | undefined;
    readonly target: DebugProtocol.StepInTarget;
}

/**
 * Upstream `StepIntoTargetsAction`: the target whose range holds the cursor, else the one starting last before it;
 * else the targets to pick from.
 */
export const stepIntoTargetsAction: CommandAction = {
    id: STEP_INTO_TARGETS_ID,
    title: "Step Into Target",
    enablement: `${STEP_INTO_TARGETS_WHEN} && editorTextFocus`,
    menus: [editorContextItem(1.5, STEP_INTO_TARGETS_WHEN)],
    async run(accessor) {
        const viewModel = accessor.get(DebugServiceDIToken).getViewModel();
        const session = viewModel.focusedSession;
        const frame = viewModel.focusedStackFrame;
        const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
        if (!session || !frame || !editor || editor.uri.toString() !== frame.source.uri.toString()) {
            notify(accessor, "info", NO_TARGETS_MESSAGE);
            return;
        }

        const targets = await session.stepInTargets(frame.frameId);
        if (!targets?.length) {
            notify(accessor, "info", NO_TARGETS_MESSAGE);
            return;
        }

        // Try to find the best target with a position to step into.
        const positionalTargets: IPositionalTarget[] = [];
        for (const target of targets) {
            if (target.line) {
                positionalTargets.push({
                    start: createPosition(target.line - 1, (target.column ?? 1) - 1),
                    end: target.endLine
                        ? createPosition(target.endLine - 1, (target.endColumn ?? 1) - 1)
                        : undefined,
                    target,
                });
            }
        }
        positionalTargets.sort((a, b) => comparePositions(b.start, a.start));

        const needle = createPosition(editor.primaryCursorLine, editor.primaryCursorColumn);
        // Try to find a target with a start and end that is around the cursor
        // position. Or, if none, whatever is before the cursor.
        const best =
            positionalTargets.find(
                (t) => t.end && comparePositions(needle, t.end) < 0 && comparePositions(t.start, needle) <= 0,
            ) ?? positionalTargets.find((t) => t.end === undefined && comparePositions(t.start, needle) <= 0);
        if (best) {
            await session.stepIn(frame.thread.threadId, best.target.id);
            return;
        }

        // Otherwise, have the user pick a target
        const picks = targets.map((target) => ({ label: target.label, target }));
        const pick = (await accessor.get(QuickInputServiceDIToken).quickPick({ items: picks })) as
            | (typeof picks)[number]
            | undefined;
        if (pick) await session.stepIn(frame.thread.threadId, pick.target.id);
    },
};

/**
 * Upstream `STEP_INTO_TARGET_ID` (Ctrl+F11): the focused frame's step targets in a quick pick, the active one's range
 * selected in the frame's editor.
 */
export const stepIntoTargetAction: CommandAction = {
    id: STEP_INTO_TARGET_ID,
    title: "Debug: Step Into Target",
    keybinding: { keys: parseKeybinding("mod+f11"), when: STEP_INTO_TARGETS_WHEN, weight: KeybindingWeight.WorkbenchContrib },
    menus: [
        {
            menuId: MenuId.CommandPalette,
            when: `debuggersAvailable && ${IN_DEBUG_MODE}`,
            enablement: STEP_INTO_TARGETS_WHEN,
        },
    ],
    async run(accessor) {
        const viewModel = accessor.get(DebugServiceDIToken).getViewModel();
        const session = viewModel.focusedSession;
        const frame = viewModel.focusedStackFrame;
        if (!frame || !session) return;
        const active = accessor.get(EditorServiceDIToken).getActiveEditor();
        const editor = active?.uri.toString() === frame.source.uri.toString() ? active : undefined;

        const targets = await session.stepInTargets(frame.frameId);
        const picks = (targets ?? []).map((target) => ({ label: target.label, target }));
        const pick = (await accessor.get(QuickInputServiceDIToken).quickPick({
            placeholder: picks.length > 0 ? undefined : "No step targets available",
            items: picks,
            onDidChangeActive: (item) => {
                const target = (item as (typeof picks)[number] | undefined)?.target;
                if (editor && target?.line !== undefined) {
                    const range = createRange(
                        target.line - 1,
                        (target.column ?? 1) - 1,
                        (target.endLine ?? target.line) - 1,
                        (target.endColumn ?? target.column ?? 1) - 1,
                    );
                    editor.viewState.selections = [
                        createSelection(range.start.line, range.start.character, range.end.line, range.end.character),
                    ];
                    editor.revealRange(range);
                }
            },
        })) as (typeof picks)[number] | undefined;
        if (pick) await session.stepIn(frame.thread.threadId, pick.target.id);
    },
};

/** Upstream `SelectionToReplAction`: the selection, else the cursor's trimmed line, evaluated in the Debug Console. */
export const selectionToReplAction: CommandAction = {
    id: SELECTION_TO_REPL_ID,
    title: "Evaluate in Debug Console",
    enablement: `${IN_DEBUG_MODE} && editorTextFocus`,
    menus: [editorContextItem(0, IN_DEBUG_MODE)],
    run(accessor) {
        const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
        if (!editor || !accessor.get(DebugServiceDIToken).getViewModel().focusedSession) return;
        const text = selectedText(editor) ?? editor.viewState.document.getLineContent(editor.primaryCursorLine).trim();
        accessor.get(ViewsServiceDIToken).openView(REPL_VIEW_ID, false);
        accessor.get(ReplDIToken).sendReplInput(text);
    },
};

/** Upstream `SelectionToWatchExpressionsAction`: the selection, else the expression around the cursor, watched. */
export const selectionToWatchAction: CommandAction = {
    id: SELECTION_TO_WATCH_ID,
    title: "Add to Watch",
    enablement: `${IN_DEBUG_MODE} && editorTextFocus`,
    menus: [editorContextItem(1, IN_DEBUG_MODE)],
    run(accessor) {
        const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
        if (!editor) return;
        let expression = selectedText(editor);
        if (expression === undefined) {
            // Upstream's one-size-fits-all strategy of `getEvaluatableExpressionAtPosition`.
            const lineContent = editor.viewState.document.getLineContent(editor.primaryCursorLine);
            const column = editor.primaryCursorColumn + 1;
            const { start, end } = getExactExpressionStartAndEnd(lineContent, column, column);
            expression = lineContent.substring(start - 1, end);
        }
        if (!expression) return;
        accessor.get(ViewsServiceDIToken).openView(WATCH_VIEW_ID, false);
        accessor.get(DebugServiceDIToken).addWatchExpression(expression);
    },
};

/** The primary selection's text; none for an empty selection. */
function selectedText(editor: TextEditorPane): string | undefined {
    const text = editor.getSelectedTexts()[0];
    return text ? text : undefined;
}

/**
 * Upstream `GoToBreakpointAction`: the next (previous) enabled breakpoint of the file after (before) the cursor's
 * line, else of the files after (before) it, else the first (last) one.
 */
function goToBreakpointAction(id: string, title: string, isNext: boolean): CommandAction {
    return {
        id,
        title,
        enablement: "debuggersAvailable",
        async run(accessor) {
            const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
            if (!editor) return;
            const currentUri = editor.uri.toString();
            const currentLine = editor.primaryCursorLine + 1;
            //Breakpoints returned from `getBreakpoints` are already sorted.
            const allEnabledBreakpoints = accessor
                .get(DebugServiceDIToken)
                .getModel()
                .getBreakpoints({ enabledOnly: true });

            //Try to find breakpoint in current file
            let moveBreakpoint = isNext
                ? allEnabledBreakpoints
                      .filter((bp) => bp.uri.toString() === currentUri && bp.lineNumber > currentLine)
                      .shift()
                : allEnabledBreakpoints
                      .filter((bp) => bp.uri.toString() === currentUri && bp.lineNumber < currentLine)
                      .pop();

            //Try to find breakpoints in following files
            moveBreakpoint ??= isNext
                ? allEnabledBreakpoints.filter((bp) => bp.uri.toString() > currentUri).shift()
                : allEnabledBreakpoints.filter((bp) => bp.uri.toString() < currentUri).pop();

            //Move to first or last possible breakpoint
            moveBreakpoint ??= isNext ? allEnabledBreakpoints.at(0) : allEnabledBreakpoints.at(-1);

            if (moveBreakpoint) {
                await accessor.get(BreakpointSourcesDIToken).openBreakpoint(moveBreakpoint, false);
            }
        },
    };
}

export const goToNextBreakpointAction = goToBreakpointAction(
    GO_TO_NEXT_BREAKPOINT_ID,
    "Debug: Go to Next Breakpoint",
    true,
);

export const goToPreviousBreakpointAction = goToBreakpointAction(
    GO_TO_PREVIOUS_BREAKPOINT_ID,
    "Debug: Go to Previous Breakpoint",
    false,
);

/**
 * Upstream `inlineBreakpointHandler` (Shift+F9): a breakpoint at the cursor's column (at the line's start, a line
 * breakpoint), unless one is there.
 */
export const toggleInlineBreakpointAction: CommandAction = {
    id: TOGGLE_INLINE_BREAKPOINT_ID,
    title: "Debug: Inline Breakpoint",
    keybinding: { keys: parseKeybinding("shift+f9"), when: "editorTextFocus", weight: KeybindingWeight.WorkbenchContrib },
    menus: [
        { menuId: MenuId.CommandPalette, when: "debuggersAvailable" },
        editorContextItem(1, IN_DEBUG_MODE, "Add Inline Breakpoint"),
    ],
    async run(accessor) {
        const debugService = accessor.get(DebugServiceDIToken);
        const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
        if (!editor || !debugService.canSetBreakpointsIn(editor.languageId)) return;
        const lineNumber = editor.primaryCursorLine + 1;
        const column = editor.primaryCursorColumn + 1;
        const breakpointAlreadySet = debugService
            .getModel()
            .getBreakpoints({ lineNumber, uri: editor.uri })
            .some((bp) => bp.sessionAgnosticData.column === column || (!bp.column && column <= 1));

        if (!breakpointAlreadySet) {
            await debugService.addBreakpoints(editor.uri, [{ lineNumber, column: column > 1 ? column : undefined }]);
        }
    },
};

/** Upstream `CloseExceptionWidgetAction` (Escape). */
export const closeExceptionWidgetAction: CommandAction = {
    id: CLOSE_EXCEPTION_WIDGET_ID,
    title: "Close Exception Widget",
    keybinding: { keys: parseKeybinding("escape"), when: "editorTextFocus", weight: KeybindingWeight.EditorContrib },
    enablement: "exceptionWidgetVisible",
    run(accessor) {
        accessor.get(DebugEditorContributionDIToken).closeExceptionWidget();
    },
};

export const BREAKPOINT_EDITOR_ACTIONS: readonly CommandAction[] = [
    toggleEditorBreakpointAction,
    conditionalBreakpointAction,
    addLogPointAction,
    triggerByBreakpointAction,
    editBreakpointAction,
    runToCursorAction,
    jumpToCursorAction,
    stepIntoTargetsAction,
    stepIntoTargetAction,
    selectionToReplAction,
    selectionToWatchAction,
    goToNextBreakpointAction,
    goToPreviousBreakpointAction,
    toggleInlineBreakpointAction,
    closeExceptionWidgetAction,
];
