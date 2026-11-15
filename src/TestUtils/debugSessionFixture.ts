// Upstream `createTestSession` of `contrib/debug/test/browser/callStack.test.ts`: a real `DebugSession` over a debug
// model, with a debug service that is the model, a view model and spies.

import { vi } from "vitest";

import { ContextKeyService } from "../vs/platform/contextkey/common/contextKeyService.ts";
import { NULL_LOGGER } from "../vs/platform/log/common/nullLogService.ts";
import { DebugSession, type IDebugSessionServices } from "../vs/workbench/contrib/debug/browser/debugSession.ts";
import type {
    IConfig,
    IDebugService,
    IDebugSessionOptions,
    IStackFrame,
    IThread,
    ReplSeverity,
} from "../vs/workbench/contrib/debug/common/debug.ts";
import type { DebugModel } from "../vs/workbench/contrib/debug/common/debugModel.ts";
import { ViewModel } from "../vs/workbench/contrib/debug/common/debugViewModel.ts";
import type { IReplConsoleConfiguration } from "../vs/workbench/contrib/debug/common/replModel.ts";

export const DEFAULT_REPL_CONFIGURATION: IReplConsoleConfiguration = {
    collapseIdenticalLines: true,
    maximumLines: 10000,
};

export interface ITestSessionServices extends IDebugSessionServices {
    readonly errors: string[];
    readonly notifications: { message: string; severity: ReplSeverity; source: string }[];
}

export function testSessionServices(
    replConfiguration: IReplConsoleConfiguration = DEFAULT_REPL_CONFIGURATION,
): ITestSessionServices {
    const errors: string[] = [];
    const notifications: ITestSessionServices["notifications"] = [];
    return {
        errors,
        notifications,
        notifier: {
            error: (message) => errors.push(message),
            notify: (message, severity, source) => notifications.push({ message, severity, source }),
        },
        logger: NULL_LOGGER,
        replConfiguration: () => replConfiguration,
    };
}

export type TestDebugService = IDebugService & {
    readonly viewModel: ViewModel;
    readonly contextKeys: ContextKeyService;
};

/**
 * A debug service as far as a session calls it: the model, a view model, focus as upstream's
 * `getStackFrameThreadAndSessionToFocus` minus the stopped-session search; the breakpoint calls are spies.
 */
export function testDebugService(model: DebugModel): TestDebugService {
    const contextKeys = new ContextKeyService();
    const viewModel = new ViewModel(contextKeys);
    const focusStackFrame = (
        stackFrame: IStackFrame | undefined,
        thread?: IThread,
        session?: IDebugSessionOptions["parentSession"],
        options?: { explicit?: boolean },
    ): Promise<void> => {
        const focusThread = thread ?? stackFrame?.thread ?? session?.getAllThreads().find((t) => t.stopped);
        const focusSession = session ?? focusThread?.session;
        viewModel.setFocus(
            stackFrame ?? focusThread?.getTopStackFrame(),
            focusThread,
            focusSession,
            !!options?.explicit,
        );
        return Promise.resolve();
    };
    return {
        viewModel,
        contextKeys,
        state: 0,
        onDidChangeState: () => ({ dispose: () => undefined }),
        onWillNewSession: () => ({ dispose: () => undefined }),
        onDidNewSession: () => ({ dispose: () => undefined }),
        onDidEndSession: () => ({ dispose: () => undefined }),
        getAdapterManager: () => {
            throw new Error("not in the fixture");
        },
        getModel: () => model,
        getViewModel: () => viewModel,
        focusStackFrame: vi.fn(focusStackFrame),
        setExceptionBreakpointsForSession: vi.fn(
            (
                session: IDebugSessionOptions["parentSession"] & object,
                filters: DebugProtocol.ExceptionBreakpointsFilter[],
            ) => {
                model.setExceptionBreakpointsForSession(session.getId(), filters);
            },
        ),
        sendAllBreakpoints: vi.fn(() => Promise.resolve()),
        sendBreakpoints: vi.fn(() => Promise.resolve()),
        startDebugging: vi.fn(() => Promise.resolve(true)),
        restartSession: vi.fn(() => Promise.resolve()),
        stopSession: vi.fn(() => Promise.resolve()),
    };
}

let nextSessionId = 0;

export function createTestDebugSession(
    model: DebugModel,
    name = "mockSession",
    options?: IDebugSessionOptions,
    debugService: IDebugService = testDebugService(model),
    services: IDebugSessionServices = testSessionServices(),
    configuration: Partial<IConfig> = {},
): DebugSession {
    return new DebugSession(
        `test-session-${String(++nextSessionId)}`,
        { resolved: { name, type: "node", request: "launch", ...configuration }, unresolved: undefined },
        undefined,
        model,
        options,
        debugService,
        services,
    );
}
