// Upstream `contrib/debug/test/common/mockDebug.ts` and `test/browser/mockDebugModel.ts`: a debug model over an
// in-memory workspace store, and a session whose members are what the test gives it.

import { Emitter, Event } from "../vs/base/common/event.ts";
import type { IDisposable } from "../vs/base/common/lifecycle.ts";
import { ContextKeyService } from "../vs/platform/contextkey/common/contextKeyService.ts";
import { NULL_LOGGER } from "../vs/platform/log/common/nullLogService.ts";
import type { IStateDescriptor, IStateService } from "../vs/platform/state/common/iStateService.ts";
import type { WorkspaceId } from "../vs/platform/workspace/common/iWorkspaceContextService.ts";
import type {
    IAdapterManagerPorts,
    IDebuggerGuessPorts,
} from "../vs/workbench/contrib/debug/browser/debugAdapterManager.ts";
import {
    type IDebugService,
    type IDebugSession,
    type IDebugTerminalLauncher,
    type IDebugVariableResolver,
    State,
} from "../vs/workbench/contrib/debug/common/debug.ts";
import { DebugModel, type ITextFileDirtyState } from "../vs/workbench/contrib/debug/common/debugModel.ts";
import { DebugStorage } from "../vs/workbench/contrib/debug/common/debugStorage.ts";

export type MockStateService = Pick<IStateService, "get" | "store" | "remove" | "onDidOpenWorkspace"> & {
    values: Map<string, unknown>;
    /** Replaces the store with `next`, like opening another folder. */
    openWorkspace(next: Map<string, unknown>): void;
};

export function mockStateService(): MockStateService {
    const onDidOpenWorkspace = new Emitter<WorkspaceId>();
    const state = {
        values: new Map<string, unknown>(),
        get: <T>(descriptor: IStateDescriptor<T>): T =>
            state.values.has(descriptor.key) ? (state.values.get(descriptor.key) as T) : descriptor.default,
        store: <T>(descriptor: IStateDescriptor<T>, value: T): void => {
            state.values.set(descriptor.key, value);
        },
        remove: <T>(descriptor: IStateDescriptor<T>): void => {
            state.values.delete(descriptor.key);
        },
        onDidOpenWorkspace: onDidOpenWorkspace.event,
        openWorkspace: (next: Map<string, unknown>): void => {
            state.values = next;
            onDidOpenWorkspace.fire("other" as WorkspaceId);
        },
    };
    return state;
}

export const NO_DIRTY_FILES: ITextFileDirtyState = { isDirty: () => false };

/** A terminal launcher for tests that don't run anything in a terminal: no process id. */
export const NO_TERMINAL_LAUNCHER: IDebugTerminalLauncher = { runInTerminal: () => Promise.resolve(undefined) };

/** A configuration resolver for tests whose configurations have no variables: the configuration as is. */
export const NO_VARIABLES: IDebugVariableResolver = (_folder, config) => Promise.resolve(config);

/** The adapter manager's ports for tests: no extensions to activate, no terminal, no variables, no editor or user. */
export function adapterManagerPorts(overrides: Partial<IAdapterManagerPorts> = {}): IAdapterManagerPorts {
    return {
        contextKeys: new ContextKeyService(),
        terminalLauncher: NO_TERMINAL_LAUNCHER,
        /* v8 ignore next -- test helper: a test that activates passes its own `extensions` */
        extensions: { activateByEvent: () => Promise.resolve() },
        variables: NO_VARIABLES,
        guess: NO_GUESS,
        /* v8 ignore next -- test helper: a test of the setting passes its own */
        allowBreakpointsEverywhere: () => false,
        ...overrides,
    };
}

/* v8 ignore start -- test helper: a test that guesses a debugger passes its own `guess` */
/** No active editor; the user cancels every question. */
export const NO_GUESS: IDebuggerGuessPorts = {
    activeLanguage: () => undefined,
    pick: () => Promise.resolve(undefined),
    confirm: () => Promise.resolve(false),
    installDebuggers: () => undefined,
};
/* v8 ignore stop */

/** The debug service of an adapter manager test that starts no session. */
export function idleDebugService(): IDebugService {
    return { onDidNewSession: Event.None } as Partial<IDebugService> as IDebugService;
}

export function createMockDebugModel(
    disposables: { add<T extends IDisposable>(o: T): T },
    state: MockStateService = mockStateService(),
    textFileService: ITextFileDirtyState = NO_DIRTY_FILES,
): DebugModel {
    const storage = disposables.add(new DebugStorage(state, textFileService, NULL_LOGGER));
    return disposables.add(new DebugModel(storage, textFileService, NULL_LOGGER));
}

/**
 * Upstream `MockSession`: id `mock`, name `mockname`, stopped, no capabilities. A member the test does not give is
 * missing: calling it fails, as upstream's "not implemented". The session is the test's object itself, so what the
 * test assigns later is what the model reads.
 */
export function mockSession(overrides: Partial<IDebugSession> = {}): IDebugSession {
    const defaults: Partial<IDebugSession> = {
        getId: () => "mock",
        name: "mockname",
        configuration: { type: "mock", name: "mock", request: "launch" },
        state: State.Stopped,
        capabilities: {},
        autoExpandLazyVariables: false,
        parentSession: undefined,
    };
    return Object.setPrototypeOf(overrides, defaults) as IDebugSession;
}

let nextSessionId = 0;

/**
 * Upstream `createTestSession`, as far as the model reads a session: a unique id, the configuration name as the
 * label until `setName`, the parent; `dispose` is recorded.
 */
export function testSession(
    name = "mockSession",
    options: { parentSession?: IDebugSession; state?: IDebugSession["state"] } = {},
): IDebugSession & { disposed: boolean } {
    const id = `session-${String(++nextSessionId)}`;
    let label = name;
    const fields = {
        disposed: false,
        getId: () => id,
        getLabel: () => label,
        setName: (newName: string) => {
            label = newName;
        },
        dispose: () => {
            fields.disposed = true;
        },
        configuration: { type: "mock", name, request: "launch" },
        parentSession: options.parentSession,
        state: options.state ?? State.Running,
    };
    return mockSession(fields) as IDebugSession & { disposed: boolean };
}
