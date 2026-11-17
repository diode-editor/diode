/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/debugCommands.ts
// The session and launch configuration commands of upstream's `debugCommands.ts` and `debugViewlet.ts` with their
// Linux keys and `when`, and their palette entries of `debug.contribution.ts` ("Debug: …", shown only with
// `debuggersAvailable`). A command run from a call stack row gets the row as `{ sessionId, threadId, frameId }`
// after the resource argument, as upstream; from a key or the palette it acts on the focused thread. Deviations: F5
// without a selected configuration opens Select and Start Debugging (upstream guesses a debugger, #1156); Open
// 'launch.json' is in the palette without upstream's `debugUx != 'simple'` precondition (there is no Run and Debug
// welcome view to create launch.json from yet, #1144); Add Configuration inserts an empty line in `configurations`
// without the snippet suggestions (milestone 2); Focus Session does not open the frame in the editor (#1148); the
// instruction stepping of the disassembly view is not planned. The editor's, the views' and the console's commands
// come with their tasks.

import { findNodeAtLocation, modify, parseTree } from "jsonc-parser";

import { codicon } from "../../../../base/common/codicons.ts";
import {
    type CommandAction,
    type CommandMenuPlacement,
    HIDDEN_FROM_PALETTE,
} from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { ClipboardDIToken } from "../../../../platform/clipboard/common/iClipboard.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { LAUNCH_FILE_NAME } from "../../../../platform/configuration/common/workspaceSettings.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../../platform/keybinding/common/keybindingResolver.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { NotificationServiceDIToken } from "../../../services/notification/browser/notificationService.ts";
import { QuickOpenServiceDIToken } from "../../quickaccess/browser/quickOpenService.ts";
import { positionAt } from "../../tasks/common/tasksJsonEdits.ts";
import {
    type IConfig,
    type IDebugService,
    type IDebugSession,
    type ILaunch,
    isFrameDeemphasized,
    type IStackFrame,
    type IThread,
    VIEWLET_ID,
} from "../common/debug.ts";
import type { Thread } from "../common/debugModel.ts";
import { resolveChildSession } from "../common/debugUtils.ts";

import { BREAKPOINT_EDIT_ACTIONS } from "./breakpointEditActions.ts";
import { rowMenuItem } from "./debugContextMenus.ts";
import { BREAKPOINT_EDITOR_ACTIONS, showDebugHoverAction } from "./debugEditorActions.ts";
import { ADD_CONFIGURATION_ID, StartDebugQuickAccessProvider } from "./debugQuickAccess.ts";
import { DebugServiceDIToken, DebugServicePortsDIToken } from "./debugService.ts";
import { DEBUG_VIEW_ACTIONS } from "./debugViewActions.ts";
import { REPL_ACTIONS } from "./replActions.ts";
import { VARIABLES_ACTIONS } from "./variablesActions.ts";

export const RESTART_SESSION_ID = "workbench.action.debug.restart";
export const TERMINATE_THREAD_ID = "workbench.action.debug.terminateThread";
export const STEP_OVER_ID = "workbench.action.debug.stepOver";
export const STEP_INTO_ID = "workbench.action.debug.stepInto";
export const STEP_OUT_ID = "workbench.action.debug.stepOut";
export const PAUSE_ID = "workbench.action.debug.pause";
export const DISCONNECT_ID = "workbench.action.debug.disconnect";
export const STOP_ID = "workbench.action.debug.stop";
export const RESTART_FRAME_ID = "workbench.action.debug.restartFrame";
export const CONTINUE_ID = "workbench.action.debug.continue";
export const FOCUS_SESSION_ID = "workbench.action.debug.focusProcess";
export const DEBUG_START_COMMAND_ID = "workbench.action.debug.start";
export const DEBUG_RUN_COMMAND_ID = "workbench.action.debug.run";
export const CALLSTACK_TOP_ID = "workbench.action.debug.callStackTop";
export const CALLSTACK_BOTTOM_ID = "workbench.action.debug.callStackBottom";
export const CALLSTACK_UP_ID = "workbench.action.debug.callStackUp";
export const CALLSTACK_DOWN_ID = "workbench.action.debug.callStackDown";
export const START_FROM_CONFIG_ID = "debug.startFromConfig";
export const SELECT_AND_START_ID = "workbench.action.debug.selectandstart";
export const DEBUG_CONFIGURE_COMMAND_ID = "workbench.action.debug.configure";
export const COPY_STACK_TRACE_ID = "debug.copyStackTrace";

const IN_DEBUG_MODE = "inDebugMode";
const STOPPED = "debugState == 'stopped'";
const NOT_INITIALIZING = "debugState != 'initializing'";

/** Upstream `registerDebugCommandPaletteItem`: listed only with debuggers, and while `when` holds. */
function paletteItem(when?: string, enablement?: string): CommandMenuPlacement[] {
    return [
        {
            menuId: MenuId.CommandPalette,
            when: when === undefined ? "debuggersAvailable" : `debuggersAvailable && ${when}`,
            enablement,
        },
    ];
}

/**
 * Upstream `registerDebugToolBarItem` (`debugToolBar.ts`): a button of the debug toolbar (`DockedDebugToolbarItems`
 * copies it to the Run and Debug title for `debug.toolBarLocation: docked`).
 */
function toolBarItem(
    title: string,
    order: number,
    icon: string,
    iconColor: string,
    when?: string,
    enablement?: string,
): CommandMenuPlacement[] {
    return [
        {
            menuId: MenuId.DebugToolBar,
            when,
            title,
            group: "navigation",
            order,
            icon: codicon(icon),
            iconColor,
            enablement,
        },
    ];
}

/**
 * Upstream `registerDebugViewMenuItem` on `MenuId.DebugCallStackContext` (`debug.contribution.ts`): an item of a call
 * stack row's menu, shown for the row type of `when`; `enablement` is upstream's precondition.
 */
function callStackItem(
    title: string,
    order: number,
    when: string,
    enablement?: string,
    group = "navigation",
): CommandMenuPlacement {
    return { ...rowMenuItem(MenuId.DebugCallStackContext, group, order, when, enablement), title };
}

const SESSION_ROW = "callStackItemType == 'session'";
const THREAD_ROW = "callStackItemType == 'thread'";
const FRAME_ROW = "callStackItemType == 'stackFrame'";

interface CallStackContext {
    sessionId: string;
    threadId?: string;
    frameId?: string;
}

function isSessionContext(obj: unknown): obj is CallStackContext {
    return typeof (obj as Partial<CallStackContext> | undefined)?.sessionId === "string";
}

function isThreadContext(obj: unknown): obj is Required<Pick<CallStackContext, "sessionId" | "threadId">> {
    return isSessionContext(obj) && typeof obj.threadId === "string";
}

function isStackFrameContext(obj: unknown): obj is Required<CallStackContext> {
    return isThreadContext(obj) && typeof (obj as CallStackContext).frameId === "string";
}

async function getThreadAndRun(
    accessor: ServiceAccessor,
    sessionAndThreadId: unknown,
    run: (thread: IThread) => Promise<void>,
): Promise<void> {
    const debugService = accessor.get(DebugServiceDIToken);
    let thread: IThread | undefined;
    if (isSessionContext(sessionAndThreadId)) {
        const threads = debugService.getModel().getSession(sessionAndThreadId.sessionId)?.getAllThreads() ?? [];
        thread = isThreadContext(sessionAndThreadId)
            ? threads.find((t) => t.getId() === sessionAndThreadId.threadId)
            : threads.at(0);
    }

    thread ??=
        debugService.getViewModel().focusedThread ?? debugService.getViewModel().focusedSession?.getAllThreads().at(0);

    if (thread) {
        await run(thread);
    }
}

function getFrame(debugService: IDebugService, context: unknown): IStackFrame | undefined {
    if (isStackFrameContext(context)) {
        return debugService
            .getModel()
            .getSession(context.sessionId)
            ?.getAllThreads()
            .find((t) => t.getId() === context.threadId)
            ?.getCallStack()
            .find((sf) => sf.getId() === context.frameId);
    }
    return debugService.getViewModel().focusedStackFrame;
}

async function navigateCallStack(debugService: IDebugService, down: boolean): Promise<void> {
    const frame = debugService.getViewModel().focusedStackFrame;
    if (frame) {
        let callStack = frame.thread.getCallStack();
        let index = callStack.findIndex((elem) => elem.frameId === frame.frameId);
        let nextVisibleFrame;
        if (down) {
            // Upstream goes to the top at the end of a fully loaded stack; the model then loads nothing, and the
            // search below wraps to the top all the same.
            if (index >= callStack.length - 1) {
                await debugService.getModel().fetchCallstack(frame.thread, 20);
                callStack = frame.thread.getCallStack();
                index = callStack.findIndex((elem) => elem.frameId === frame.frameId);
            }
            nextVisibleFrame = findNextVisibleFrame(true, callStack, index);
        } else {
            if (index <= 0) {
                await goToBottomOfCallStack(debugService);
                return;
            }
            nextVisibleFrame = findNextVisibleFrame(false, callStack, index);
        }

        if (nextVisibleFrame) {
            await debugService.focusStackFrame(nextVisibleFrame);
        }
    }
}

async function goToBottomOfCallStack(debugService: IDebugService): Promise<void> {
    const thread = debugService.getViewModel().focusedThread;
    if (thread) {
        await debugService.getModel().fetchCallstack(thread);
        const callStack = thread.getCallStack();
        if (callStack.length > 0) {
            const nextVisibleFrame = findNextVisibleFrame(false, callStack, 0); // must consider the next frame up first, which will be the last frame
            if (nextVisibleFrame) {
                await debugService.focusStackFrame(nextVisibleFrame);
            }
        }
    }
}

async function goToTopOfCallStack(debugService: IDebugService): Promise<void> {
    const thread = debugService.getViewModel().focusedThread;
    if (thread) {
        await debugService.focusStackFrame(thread.getTopStackFrame());
    }
}

/**
 * Finds next frame that is not skipped by SkipFiles. Skips frame at index and starts searching at next.
 * Must satisfy `0 <= startIndex <= callStack - 1`
 * @param down specifies whether to search downwards if the current file is skipped.
 * @param callStack the call stack to search
 * @param startIndex the index to start the search at
 */
function findNextVisibleFrame(
    down: boolean,
    callStack: readonly IStackFrame[],
    startIndex: number,
): IStackFrame | undefined {
    // Upstream clamps the start into the stack; only a frame no longer in it (index -1) is below.
    startIndex = Math.max(startIndex, 0);

    let index = startIndex;
    let currFrame;
    do {
        if (down) {
            index = index === callStack.length - 1 ? 0 : index + 1;
        } else {
            index = index === 0 ? callStack.length - 1 : index - 1;
        }

        currFrame = callStack[index];
        if (!isFrameDeemphasized(currFrame)) {
            return currFrame;
        }
    } while (index !== startIndex); // end loop when we've just checked the start index, since that should be the last one checked

    return undefined;
}

/** The session of a call stack row, or the focused one. */
function sessionOf(debugService: IDebugService, context: unknown): IDebugSession | undefined {
    return isSessionContext(context)
        ? debugService.getModel().getSession(context.sessionId)
        : debugService.getViewModel().focusedSession;
}

async function stopHandler(accessor: ServiceAccessor, context: unknown, disconnect: boolean): Promise<void> {
    const debugService = accessor.get(DebugServiceDIToken);
    const session = sessionOf(debugService, context);
    // Child sessions (milestone 3) send the stop to the root parent while `debug.showSubSessionsInToolBar` is off.
    await debugService.stopSession(session, disconnect);
}

export const restartSessionAction: CommandAction = {
    id: RESTART_SESSION_ID,
    title: "Debug: Restart",
    keybinding: {
        keys: parseKeybinding("mod+shift+f5"),
        when: IN_DEBUG_MODE,
        weight: KeybindingWeight.WorkbenchContrib,
    },
    menus: [
        ...paletteItem(),
        ...toolBarItem("Restart", 60, "debug-restart", "debugIcon.restartForeground"),
        callStackItem("Restart", 10, SESSION_ROW, undefined, "3_modification"),
    ],
    async run(accessor, _, context) {
        const debugService = accessor.get(DebugServiceDIToken);
        const session = sessionOf(debugService, context);
        if (!session) {
            const { launch, name } = debugService.getConfigurationManager().selectedConfiguration;
            await debugService.startDebugging(launch, name, { noDebug: false, startedByUser: true });
        } else {
            session.removeReplExpressions();
            await debugService.restartSession(session);
        }
    },
};

export const stepOverAction: CommandAction = {
    id: STEP_OVER_ID,
    title: "Debug: Step Over",
    keybinding: { keys: parseKeybinding("f10"), when: STOPPED, weight: KeybindingWeight.WorkbenchContrib },
    menus: [
        ...paletteItem(IN_DEBUG_MODE, STOPPED),
        ...toolBarItem("Step Over", 20, "debug-step-over", "debugIcon.stepOverForeground", undefined, STOPPED),
        callStackItem("Step Over", 20, THREAD_ROW, STOPPED),
    ],
    async run(accessor, _, context) {
        await getThreadAndRun(accessor, context, (thread) => thread.next());
    },
};

export const stepIntoAction: CommandAction = {
    id: STEP_INTO_ID,
    title: "Debug: Step Into",
    // Have a stronger weight to have priority over full screen when debugging; a more flexible when clause to not
    // allow full screen command to take over when F11 pressed a lot of times.
    keybinding: {
        keys: parseKeybinding("f11"),
        when: "debugState != 'inactive'",
        weight: KeybindingWeight.WorkbenchContrib + 10,
    },
    menus: [
        ...paletteItem(IN_DEBUG_MODE, STOPPED),
        ...toolBarItem("Step Into", 30, "debug-step-into", "debugIcon.stepIntoForeground", undefined, STOPPED),
        callStackItem("Step Into", 30, THREAD_ROW, STOPPED),
    ],
    async run(accessor, _, context) {
        await getThreadAndRun(accessor, context, (thread) => thread.stepIn());
    },
};

export const stepOutAction: CommandAction = {
    id: STEP_OUT_ID,
    title: "Debug: Step Out",
    keybinding: { keys: parseKeybinding("shift+f11"), when: STOPPED, weight: KeybindingWeight.WorkbenchContrib },
    menus: [
        ...paletteItem(IN_DEBUG_MODE, STOPPED),
        ...toolBarItem("Step Out", 40, "debug-step-out", "debugIcon.stepOutForeground", undefined, STOPPED),
        callStackItem("Step Out", 40, THREAD_ROW, STOPPED),
    ],
    async run(accessor, _, context) {
        await getThreadAndRun(accessor, context, (thread) => thread.stepOut());
    },
};

export const pauseAction: CommandAction = {
    id: PAUSE_ID,
    title: "Debug: Pause",
    // Takes priority over F6 of "Notifications: Focus Message" while we are debugging (upstream: over focusNextPart).
    keybinding: {
        keys: parseKeybinding("f6"),
        when: "debugState == 'running'",
        weight: KeybindingWeight.WorkbenchContrib + 2,
    },
    menus: [
        ...paletteItem(IN_DEBUG_MODE, "debugState == 'running' && !focusedSessionIsNoDebug"),
        ...toolBarItem(
            "Pause",
            10,
            "debug-pause",
            "debugIcon.pauseForeground",
            "debugState != 'stopped'",
            "debugState == 'running' && !focusedSessionIsNoDebug",
        ),
        callStackItem("Pause", 10, `${THREAD_ROW} && debugState == 'running' && !focusedSessionIsNoDebug`),
    ],
    async run(accessor, _, context) {
        await getThreadAndRun(accessor, context, (thread) => thread.pause());
    },
};

export const disconnectAction: CommandAction = {
    id: DISCONNECT_ID,
    title: "Debug: Disconnect",
    keybinding: {
        keys: parseKeybinding("shift+f5"),
        when: `focusedSessionIsAttach && ${IN_DEBUG_MODE}`,
        weight: KeybindingWeight.WorkbenchContrib,
    },
    menus: [
        ...paletteItem(IN_DEBUG_MODE, "focusedSessionIsAttach || terminateDebuggeeSupported"),
        ...toolBarItem(
            "Disconnect",
            70,
            "debug-disconnect",
            "debugIcon.disconnectForeground",
            "focusedSessionIsAttach",
        ),
        callStackItem("Disconnect", 20, SESSION_ROW, undefined, "3_modification"),
    ],
    run(accessor, _, context) {
        return stopHandler(accessor, context, true);
    },
};

export const stopAction: CommandAction = {
    id: STOP_ID,
    title: "Debug: Stop",
    keybinding: {
        keys: parseKeybinding("shift+f5"),
        when: `!focusedSessionIsAttach && ${IN_DEBUG_MODE}`,
        weight: KeybindingWeight.WorkbenchContrib,
    },
    menus: [
        ...paletteItem(IN_DEBUG_MODE, "!focusedSessionIsAttach || terminateDebuggeeSupported"),
        ...toolBarItem("Stop", 70, "debug-stop", "debugIcon.stopForeground", "!focusedSessionIsAttach"),
        callStackItem("Stop", 30, SESSION_ROW, undefined, "3_modification"),
    ],
    run(accessor, _, context) {
        return stopHandler(accessor, context, false);
    },
};

export const continueAction: CommandAction = {
    id: CONTINUE_ID,
    title: "Debug: Continue",
    // Use a stronger weight to get priority over start debugging F5 shortcut
    keybinding: { keys: parseKeybinding("f5"), when: STOPPED, weight: KeybindingWeight.WorkbenchContrib + 10 },
    menus: [
        ...paletteItem(IN_DEBUG_MODE, STOPPED),
        ...toolBarItem("Continue", 10, "debug-continue", "debugIcon.continueForeground", STOPPED),
        callStackItem("Continue", 10, `${THREAD_ROW} && ${STOPPED}`),
    ],
    async run(accessor, _, context) {
        await getThreadAndRun(accessor, context, (thread) => thread.continue());
    },
};

export const terminateThreadAction: CommandAction = {
    id: TERMINATE_THREAD_ID,
    title: "Debug: Terminate Thread",
    menus: [
        ...paletteItem(IN_DEBUG_MODE, "terminateThreadsSupported"),
        callStackItem("Terminate Thread", 10, THREAD_ROW, "terminateThreadsSupported", "termination"),
    ],
    async run(accessor, _, context) {
        await getThreadAndRun(accessor, context, (thread) => thread.terminate());
    },
};

export const restartFrameAction: CommandAction = {
    id: RESTART_FRAME_ID,
    title: "Restart Frame",
    menus: [
        ...HIDDEN_FROM_PALETTE,
        callStackItem("Restart Frame", 10, `${FRAME_ROW} && restartFrameSupported`, "stackFrameSupportsRestart"),
    ],
    async run(accessor, _, context) {
        const frame = getFrame(accessor.get(DebugServiceDIToken), context);
        try {
            await frame?.restart();
        } catch (e) {
            accessor.get(NotificationServiceDIToken).show({
                severity: "error",
                message: (e as Error).message,
                modal: false,
                items: [],
            });
        }
    },
};

export const copyStackTraceAction: CommandAction = {
    id: COPY_STACK_TRACE_ID,
    title: "Copy Call Stack",
    menus: [...HIDDEN_FROM_PALETTE, callStackItem("Copy Call Stack", 20, FRAME_ROW, undefined, "3_modification")],
    async run(accessor, _, context) {
        const frame = getFrame(accessor.get(DebugServiceDIToken), context);
        if (frame) {
            // Upstream joins with the EOL of the frame's file; the clipboard of a terminal takes "\n".
            await accessor.get(ClipboardDIToken).writeText(
                frame.thread
                    .getCallStack()
                    .map((sf) => sf.toString())
                    .join("\n"),
            );
        }
    },
};

export const callStackTopAction: CommandAction = {
    id: CALLSTACK_TOP_ID,
    title: "Debug: Navigate to Top of Call Stack",
    menus: paletteItem(IN_DEBUG_MODE, STOPPED),
    run(accessor) {
        return goToTopOfCallStack(accessor.get(DebugServiceDIToken));
    },
};

export const callStackBottomAction: CommandAction = {
    id: CALLSTACK_BOTTOM_ID,
    title: "Debug: Navigate to Bottom of Call Stack",
    menus: paletteItem(IN_DEBUG_MODE, STOPPED),
    run(accessor) {
        return goToBottomOfCallStack(accessor.get(DebugServiceDIToken));
    },
};

export const callStackUpAction: CommandAction = {
    id: CALLSTACK_UP_ID,
    title: "Debug: Navigate Up Call Stack",
    menus: paletteItem(IN_DEBUG_MODE, STOPPED),
    run(accessor) {
        return navigateCallStack(accessor.get(DebugServiceDIToken), false);
    },
};

export const callStackDownAction: CommandAction = {
    id: CALLSTACK_DOWN_ID,
    title: "Debug: Navigate Down Call Stack",
    menus: paletteItem(IN_DEBUG_MODE, STOPPED),
    run(accessor) {
        return navigateCallStack(accessor.get(DebugServiceDIToken), true);
    },
};

export const startFromConfigAction: CommandAction = {
    id: START_FROM_CONFIG_ID,
    title: "Start Debugging From Configuration",
    menus: HIDDEN_FROM_PALETTE,
    async run(accessor, config) {
        await accessor.get(DebugServiceDIToken).startDebugging(undefined, config as IConfig);
    },
};

export const focusSessionAction: CommandAction = {
    id: FOCUS_SESSION_ID,
    title: "Focus Session",
    menus: HIDDEN_FROM_PALETTE,
    async run(accessor, session) {
        const debugService = accessor.get(DebugServiceDIToken);
        const toFocus = resolveChildSession(session as IDebugSession, debugService.getModel().getSessions());
        await debugService.focusStackFrame(undefined, undefined, toFocus, { explicit: true });
    },
};

export const startAction: CommandAction = {
    id: DEBUG_START_COMMAND_ID,
    title: "Debug: Start Debugging",
    keybinding: {
        keys: parseKeybinding("f5"),
        when: "debuggersAvailable && debugState == 'inactive'",
        weight: KeybindingWeight.WorkbenchContrib,
    },
    menus: paletteItem(NOT_INITIALIZING),
    async run(accessor, debugStartOptions) {
        const options = debugStartOptions as { config?: Partial<IConfig>; noDebug?: boolean } | undefined;
        const debugService = accessor.get(DebugServiceDIToken);
        await accessor.get(DebugServicePortsDIToken).saveAllBeforeStart();
        const { launch, name, getConfig } = debugService.getConfigurationManager().selectedConfiguration;
        const config = await getConfig();
        if (!config && !name) {
            accessor.get(CommandRegistryDIToken).execute(SELECT_AND_START_ID);
            return;
        }
        const configOrName = config ? Object.assign(structuredClone(config), options?.config) : name;
        await debugService.startDebugging(
            launch,
            configOrName,
            { noDebug: options?.noDebug, startedByUser: true },
            false,
        );
    },
};

export const selectAndStartAction: CommandAction = {
    id: SELECT_AND_START_ID,
    title: "Debug: Select and Start Debugging",
    menus: paletteItem(NOT_INITIALIZING),
    run(accessor) {
        // A debug type picks among its dynamic configurations first (not here yet: the dynamic configurations of Select and Start Debugging).
        accessor.get(QuickOpenServiceDIToken).show(StartDebugQuickAccessProvider.PREFIX);
        return Promise.resolve();
    },
};

export const configureAction: CommandAction = {
    id: DEBUG_CONFIGURE_COMMAND_ID,
    title: "Debug: Open 'launch.json'",
    menus: paletteItem(),
    async run(accessor) {
        const debugService = accessor.get(DebugServiceDIToken);
        const configurationManager = debugService.getConfigurationManager();
        let launch: ILaunch | undefined;
        if (configurationManager.selectedConfiguration.name) {
            launch = configurationManager.selectedConfiguration.launch;
        } else {
            const launches = configurationManager.getLaunches().filter((l) => !l.hidden);
            if (launches.length === 1) {
                launch = launches[0];
            } else {
                const picks = launches.map((l) => ({ label: l.name, launch: l }));
                const picked = (await accessor.get(QuickInputServiceDIToken).quickPick({
                    placeholder:
                        "Select a workspace folder to create a launch.json file in or add it to the workspace config file",
                    items: picks,
                })) as { launch: ILaunch } | undefined;
                launch = picked?.launch;
            }
        }

        // Upstream's `addNew` comes from the debug view's start dropdown, which diode does not have yet.
        await launch?.openConfigFile({ preserveFocus: false });
    },
};

export const addConfigurationAction: CommandAction = {
    id: ADD_CONFIGURATION_ID,
    title: "Debug: Add Configuration...",
    menus: paletteItem(),
    async run(accessor, launchUri) {
        const manager = accessor.get(DebugServiceDIToken).getConfigurationManager();

        const launch =
            manager.getLaunches().find((l) => l.uri.toString() === launchUri) ?? manager.selectedConfiguration.launch;
        if (launch) {
            const { opened, created } = await launch.openConfigFile({ preserveFocus: false });
            const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
            if (opened && !created && editor?.uri.toString() === launch.uri.toString()) {
                addLaunchConfiguration(accessor, editor);
            }
        }
    },
};

/**
 * Upstream `DebugEditorContribution.addLaunchConfiguration`: a new line at the start of the `configurations` array
 * (the array is added first when it is missing), with the caret on it. Upstream then opens the snippet suggestions.
 */
function addLaunchConfiguration(accessor: ServiceAccessor, editor: TextEditorPane): void {
    const original = editor.getText();
    const isLaunchJson = editor.uri.path.endsWith(`/${LAUNCH_FILE_NAME}`);
    let configurationsArrayOffset = configurationsArrayStart(original, isLaunchJson);
    if (configurationsArrayOffset === undefined) {
        // "configurations" array doesn't exist. Add it here.
        const text = original;
        const edit = modify(
            text,
            isLaunchJson ? ["configurations"] : ["launch"],
            isLaunchJson ? [] : { configurations: [] },
            {
                formattingOptions: { tabSize: editor.viewState.tabSize, insertSpaces: editor.viewState.insertSpaces },
            },
        )[0];
        editor.applyExternalEdits(
            [
                {
                    range: { start: positionAt(text, edit.offset), end: positionAt(text, edit.offset + edit.length) },
                    text: edit.content,
                },
            ],
            // Stryker disable next-line StringLiteral: the label of an undo step is shown nowhere
            "Add Configuration",
        );
        // The array is the one the edit has just written (upstream parses the file again).
        configurationsArrayOffset = edit.offset + edit.content.indexOf("[") + 1;
    }

    // Upstream focuses the editor here; `openConfigFile` without preserveFocus has already done it.
    const text = editor.getText();
    const position = positionAt(text, configurationsArrayOffset);
    // Check if there are more characters on a line after a "configurations": [, if yes enter a newline
    const line = editor.getLinesContent()[position.line];
    editor.goToPosition(position.line, position.character);
    if (line.slice(position.character).trim().length > 0) {
        editor.insertLineBreak();
        editor.goToPosition(position.line, position.character);
    }
    accessor.get(CommandRegistryDIToken).execute("editor.action.insertLineAfter");
}

/**
 * The offset just after the `[` of `configurations` (`launch.configurations` in a settings file). Upstream visits the
 * text and takes the last `configurations` array it meets; the JSON path does not take the one of a compound.
 */
function configurationsArrayStart(text: string, isLaunchJson: boolean): number | undefined {
    const tree = parseTree(text);
    const node = tree && findNodeAtLocation(tree, isLaunchJson ? ["configurations"] : ["launch", "configurations"]);
    return node?.type === "array" ? node.offset + 1 : undefined;
}

export const runAction: CommandAction = {
    id: DEBUG_RUN_COMMAND_ID,
    title: "Debug: Start Without Debugging",
    keybinding: {
        keys: parseKeybinding("mod+f5"),
        when: `debuggersAvailable && ${NOT_INITIALIZING}`,
        weight: KeybindingWeight.WorkbenchContrib,
    },
    menus: paletteItem(NOT_INITIALIZING),
    async run(accessor) {
        await startAction.run(accessor, { noDebug: true });
    },
};

export const DEBUG_ACTIONS: readonly CommandAction[] = [
    startAction,
    runAction,
    selectAndStartAction,
    configureAction,
    addConfigurationAction,
    restartSessionAction,
    stepOverAction,
    stepIntoAction,
    stepOutAction,
    pauseAction,
    disconnectAction,
    stopAction,
    continueAction,
    terminateThreadAction,
    restartFrameAction,
    copyStackTraceAction,
    callStackTopAction,
    callStackBottomAction,
    callStackUpAction,
    callStackDownAction,
    startFromConfigAction,
    focusSessionAction,
    ...BREAKPOINT_EDITOR_ACTIONS,
    ...BREAKPOINT_EDIT_ACTIONS,
    showDebugHoverAction,
    ...DEBUG_VIEW_ACTIONS,
    ...VARIABLES_ACTIONS,
    ...REPL_ACTIONS,
];
