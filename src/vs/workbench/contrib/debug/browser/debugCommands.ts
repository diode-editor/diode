/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/debugCommands.ts
// The session commands of upstream's `debugCommands.ts` with their Linux keys and `when`, and their palette entries
// of `debug.contribution.ts` ("Debug: …", shown only with `debuggersAvailable`). A command run from a call stack row
// gets the row as `{ sessionId, threadId, frameId }` after the resource argument, as upstream; from a key or the
// palette it acts on the focused thread. Deviations: the start commands take no selected launch configuration yet
// (launch.json, #1138), so F5 starts nothing until then; Focus Session does not open the frame in the editor (#1148);
// the instruction stepping of the disassembly view is not planned. The editor's, the views' and the console's
// commands come with their tasks.

import { type CommandAction, HIDDEN_FROM_PALETTE } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../../platform/keybinding/common/keybindingResolver.ts";
import { NotificationServiceDIToken } from "../../../services/notification/browser/notificationService.ts";
import {
    type IConfig,
    type IDebugService,
    type IDebugSession,
    isFrameDeemphasized,
    type IStackFrame,
    type IThread,
} from "../common/debug.ts";
import type { Thread } from "../common/debugModel.ts";
import { resolveChildSession } from "../common/debugUtils.ts";

import { DebugServiceDIToken } from "./debugService.ts";
import { DEBUG_VIEW_ACTIONS } from "./debugViewActions.ts";

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

const IN_DEBUG_MODE = "inDebugMode";
const STOPPED = "debugState == 'stopped'";
const NOT_INITIALIZING = "debugState != 'initializing'";

/** Upstream `registerDebugCommandPaletteItem`: listed only with debuggers, and while `when` holds. */
function paletteItem(when?: string, enablement?: string): CommandAction["menus"] {
    return [
        {
            menuId: MenuId.CommandPalette,
            when: when === undefined ? "debuggersAvailable" : `debuggersAvailable && ${when}`,
            enablement,
        },
    ];
}

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
    menus: paletteItem(),
    async run(accessor, _, context) {
        const debugService = accessor.get(DebugServiceDIToken);
        const session = sessionOf(debugService, context);
        if (!session) {
            // Upstream starts the selected launch configuration here (launch.json, #1138).
            await debugService.startDebugging(undefined, undefined, { noDebug: false, startedByUser: true });
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
    menus: paletteItem(IN_DEBUG_MODE, STOPPED),
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
    menus: paletteItem(IN_DEBUG_MODE, STOPPED),
    async run(accessor, _, context) {
        await getThreadAndRun(accessor, context, (thread) => thread.stepIn());
    },
};

export const stepOutAction: CommandAction = {
    id: STEP_OUT_ID,
    title: "Debug: Step Out",
    keybinding: { keys: parseKeybinding("shift+f11"), when: STOPPED, weight: KeybindingWeight.WorkbenchContrib },
    menus: paletteItem(IN_DEBUG_MODE, STOPPED),
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
    menus: paletteItem(IN_DEBUG_MODE, "debugState == 'running' && !focusedSessionIsNoDebug"),
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
    menus: paletteItem(IN_DEBUG_MODE, "focusedSessionIsAttach || terminateDebuggeeSupported"),
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
    menus: paletteItem(IN_DEBUG_MODE, "!focusedSessionIsAttach || terminateDebuggeeSupported"),
    run(accessor, _, context) {
        return stopHandler(accessor, context, false);
    },
};

export const continueAction: CommandAction = {
    id: CONTINUE_ID,
    title: "Debug: Continue",
    // Use a stronger weight to get priority over start debugging F5 shortcut
    keybinding: { keys: parseKeybinding("f5"), when: STOPPED, weight: KeybindingWeight.WorkbenchContrib + 10 },
    menus: paletteItem(IN_DEBUG_MODE, STOPPED),
    async run(accessor, _, context) {
        await getThreadAndRun(accessor, context, (thread) => thread.continue());
    },
};

export const terminateThreadAction: CommandAction = {
    id: TERMINATE_THREAD_ID,
    title: "Debug: Terminate Thread",
    menus: paletteItem(IN_DEBUG_MODE, "terminateThreadsSupported"),
    async run(accessor, _, context) {
        await getThreadAndRun(accessor, context, (thread) => thread.terminate());
    },
};

export const restartFrameAction: CommandAction = {
    id: RESTART_FRAME_ID,
    title: "Restart Frame",
    menus: HIDDEN_FROM_PALETTE,
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
        const options = debugStartOptions as { noDebug?: boolean } | undefined;
        // Upstream starts the selected launch configuration merged with `options.config` (launch.json, #1138).
        await accessor
            .get(DebugServiceDIToken)
            .startDebugging(undefined, undefined, { noDebug: options?.noDebug, startedByUser: true });
    },
};

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
    callStackTopAction,
    callStackBottomAction,
    callStackUpAction,
    callStackDownAction,
    startFromConfigAction,
    focusSessionAction,
    ...DEBUG_VIEW_ACTIONS,
];
