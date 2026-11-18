// Upstream `createTestSession` of `contrib/debug/test/browser/callStack.test.ts`: a real `DebugSession` over a debug
// model, with a debug service that is the model, a view model and spies.

import { vi } from "vitest";

import { Event } from "../vs/base/common/event.ts";
import { ContextKeyService } from "../vs/platform/contextkey/common/contextKeyService.ts";
import { NULL_LOGGER } from "../vs/platform/log/common/nullLogService.ts";
import {
    DebugSession,
    type IDebugServiceConfiguration,
    type IDebugSessionServices,
} from "../vs/workbench/contrib/debug/browser/debugSession.ts";
import type {
    IConfig,
    ICorrelatedTestRun,
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

/** Upstream's defaults of `debug.openDebug` and `debug.autoExpandLazyVariables`. */
export const DEFAULT_DEBUG_CONFIGURATION: IDebugServiceConfiguration = {
    openDebug: "openOnDebugBreak",
    autoExpandLazyVariables: "auto",
    internalConsoleOptions: "openOnFirstSessionStart",
    console: { closeOnEnd: false },
    allowBreakpointsEverywhere: false,
    focusEditorOnBreak: true,
    showSubSessionsInToolBar: false,
    openExplorerOnEnd: false,
    closeReadonlyTabsOnEnd: false,
};

export interface ITestSessionServices extends IDebugSessionServices {
    readonly errors: string[];
    readonly notifications: { message: string; severity: ReplSeverity; source: string }[];
    /** What `debugConfiguration()` answers; tests change it in place. */
    configuration: IDebugServiceConfiguration;
    /** How many times Run and Debug was shown. */
    readonly viewletOpenings: number;
    /** The test runs of the core by id, and what was asked of them. */
    readonly testRuns: Map<string, ICorrelatedTestRun>;
    readonly cancelledTestRuns: string[];
}

export function testSessionServices(
    replConfiguration: IReplConsoleConfiguration = DEFAULT_REPL_CONFIGURATION,
): ITestSessionServices {
    const notifications: ITestSessionServices["notifications"] = [];
    const services = {
        errors: [] as string[],
        notifications,
        notifier: {
            error: (message: string) => services.errors.push(message),
            notify: (message: string, severity: ReplSeverity, source: string) =>
                notifications.push({ message, severity, source }),
        },
        logger: NULL_LOGGER,
        replConfiguration: () => replConfiguration,
        configuration: { ...DEFAULT_DEBUG_CONFIGURATION },
        viewletOpenings: 0,
        debugConfiguration: () => services.configuration,
        openViewlet: () => {
            services.viewletOpenings++;
        },
        testRuns: new Map<string, ICorrelatedTestRun>(),
        cancelledTestRuns: [] as string[],
        testing: {
            getResult: (runId: string) => services.testRuns.get(runId),
            cancelTestRun: (runId: string) => services.cancelledTestRuns.push(runId),
        },
    };
    return services;
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
        onDidChangeState: Event.None,
        onWillNewSession: Event.None,
        onDidNewSession: Event.None,
        onDidEndSession: Event.None,
        getAdapterManager: vi.fn(),
        getConfigurationManager: vi.fn(),
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
        sourceIsNotAvailable: vi.fn(),
        canSetBreakpointsIn: vi.fn(),
        updateBreakpoints: vi.fn().mockResolvedValue(undefined),
        sendAllBreakpoints: vi.fn().mockResolvedValue(undefined),
        sendBreakpoints: vi.fn().mockResolvedValue(undefined),
        addBreakpoints: vi.fn().mockResolvedValue([]),
        runTo: vi.fn().mockResolvedValue(undefined),
        enableOrDisableBreakpoints: vi.fn().mockResolvedValue(undefined),
        setBreakpointsActivated: vi.fn().mockResolvedValue(undefined),
        removeBreakpoints: vi.fn().mockResolvedValue(undefined),
        addFunctionBreakpoint: vi.fn().mockResolvedValue(undefined),
        removeFunctionBreakpoints: vi.fn().mockResolvedValue(undefined),
        updateFunctionBreakpoint: vi.fn().mockResolvedValue(undefined),
        addDataBreakpoint: vi.fn().mockResolvedValue(undefined),
        updateDataBreakpoint: vi.fn().mockResolvedValue(undefined),
        addInstructionBreakpoint: vi.fn().mockResolvedValue(undefined),
        setExceptionBreakpointCondition: vi.fn().mockResolvedValue(undefined),
        removeDataBreakpoints: vi.fn().mockResolvedValue(undefined),
        removeInstructionBreakpoints: vi.fn().mockResolvedValue(undefined),
        startDebugging: vi.fn().mockResolvedValue(true),
        restartSession: vi.fn().mockResolvedValue(undefined),
        stopSession: vi.fn().mockResolvedValue(undefined),
        addWatchExpression: vi.fn(),
        renameWatchExpression: vi.fn(),
        moveWatchExpression: vi.fn(),
        removeWatchExpressions: vi.fn(),
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
