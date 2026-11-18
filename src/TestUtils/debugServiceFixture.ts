// A `DebugService` over in-memory ports: context keys, the workspace store, notifications that record what they
// showed and answer modal questions with `answer`, an in-memory configuration (launch.json is the `launch` key of
// its workspace layer), and tasks the test lists in `tasks` and finishes through `runTask`.

import { vi } from "vitest";

import { Emitter } from "../vs/base/common/event.ts";
import { Uri } from "../vs/base/common/uri.ts";
import { ConfigurationRegistry } from "../vs/platform/configuration/common/configurationRegistry.ts";
import { InMemoryConfigurationService } from "../vs/platform/configuration/common/inMemoryConfigurationService.ts";
import { ContextKeyService } from "../vs/platform/contextkey/common/contextKeyService.ts";
import type { IExtension } from "../vs/platform/extensions/common/iExtension.ts";
import { NULL_LOGGER } from "../vs/platform/log/common/nullLogService.ts";
import type { IMarker } from "../vs/platform/markers/common/iMarker.ts";
import type { IWorkspaceFolder, WorkbenchState } from "../vs/platform/workspace/common/iWorkspaceContextService.ts";
import { debugConfiguration } from "../vs/workbench/common/configuration/debugConfiguration.ts";
import type { QuickPickItem } from "../vs/workbench/common/quickPickItem.ts";
import type { IConfigurationManagerPorts } from "../vs/workbench/contrib/debug/browser/debugConfigurationManager.ts";
import { DebugService, type IDebugServicePorts } from "../vs/workbench/contrib/debug/browser/debugService.ts";
import type { IDebugTaskRunnerPorts } from "../vs/workbench/contrib/debug/browser/debugTaskRunner.ts";
import type { IDebugVariableResolver, ILaunch } from "../vs/workbench/contrib/debug/common/debug.ts";
import type { ITaskEvent, ITaskSummary } from "../vs/workbench/contrib/tasks/browser/taskService.ts";
import { type ITask, taskMatches } from "../vs/workbench/contrib/tasks/common/tasks.ts";
import type {
    INotificationHandle,
    INotificationMessage,
} from "../vs/workbench/services/notification/browser/notificationService.ts";

import {
    type MockStateService,
    mockStateService,
    NO_DIRTY_FILES,
    NO_TERMINAL_LAUNCHER,
    NO_VARIABLES,
} from "./mockDebug.ts";

export const USER_SETTINGS = Uri.file("/user/settings.json");

/** A launch of the test's own: by default no configurations, no compounds, nothing to open. */
export function fakeLaunch(launch: Partial<ILaunch> & Pick<ILaunch, "workspace" | "getConfiguration">): ILaunch {
    return {
        uri: Uri.file("/w/.diode/launch.json"),
        name: "w",
        hidden: false,
        getCompound: () => undefined,
        /* v8 ignore start -- test helper: the defaults of what a test does not ask */
        getConfigurationNames: () => [],
        openConfigFile: () => Promise.resolve({ opened: true, created: false }),
        /* v8 ignore stop */
        ...launch,
    };
}

export interface IDebugServiceFixture {
    readonly service: DebugService;
    readonly ports: IDebugServicePorts;
    readonly contextKeys: ContextKeyService;
    readonly state: MockStateService;
    readonly configuration: InMemoryConfigurationService;
    readonly shown: INotificationMessage[];
    readonly activated: string[];
    /** The answer to the next modal questions: a button index, or `undefined` for closed. */
    answer: number | undefined;
    /** Whether the checkbox of the next questions is checked when they are answered. */
    checkboxChecked: boolean;
    folders: IWorkspaceFolder[];
    workbenchState: WorkbenchState;
    /** The tasks the task service knows; `runTask` starts one and gives the way to end it. */
    tasks: ITask[];
    readonly ran: string[];
    /** Ends the last run of the task with the exit code (`undefined`: the terminal was closed). */
    endTask(label: string, exitCode: number | undefined): void;
    /** Ran tasks resolve at once with this exit code, unless it is `"pending"`. */
    taskExitCode: number | undefined | "pending";
    markers: IMarker[];
    readonly opened: { resource: string; line?: number; preserveFocus: boolean }[];
    readonly saves: number[];
    /** The configuration resolver of launch.json; by default the configuration as is. */
    variables: IDebugVariableResolver;
    /** How many times Run and Debug was shown. */
    viewletOpenings: number;
    /** How many times the Debug Console was shown, and asked to close. */
    replOpenings: number;
    replClosings: number;
    /** The stack frames opened in the editor: `name@line` with the options. */
    readonly openedFrames: { frame: string; preserveFocus: boolean; sideBySide: boolean }[];
    /** Fires the save of a text file. */
    saveTextFile(resource: Uri): void;
    /** The extensions whose manifests name the types with dynamic configurations. */
    extensions: IExtension[];
    /** The active editor: its resource, language and the language's display name. */
    activeEditor: { resource: string; languageId: string; languageName?: string } | undefined;
    /** The row the next pickers pick, by label (a list answers them in turn); `undefined` cancels them. */
    pickLabel: string | string[] | undefined;
    /** What the pickers showed: their placeholder and rows (a row's hint after ` | `). */
    readonly picks: { placeholder: string; rows: string[] }[];
    /** The answer to the "no extension for debugging" question. */
    confirmAnswer: boolean;
    readonly confirms: string[];
    /** The Marketplace searches for debuggers, by their query. */
    readonly installs: (string | undefined)[];
}

function pickRows(items: readonly QuickPickItem[]): string[] {
    return items.map((item) => (item.hint === undefined ? item.label : `${item.label} | ${item.hint}`));
}

/** `state`: the workspace store of an earlier service, as a window that opens the same folder again. */
export function createDebugServiceFixture(
    options: {
        readonly workspaceLaunch?: unknown;
        readonly folders?: IWorkspaceFolder[];
        readonly state?: MockStateService;
    } = {},
): IDebugServiceFixture {
    const contextKeys = new ContextKeyService();
    const state = options.state ?? mockStateService();
    const shown: INotificationMessage[] = [];
    const activated: string[] = [];
    const ran: string[] = [];
    const runs = new Map<string, PromiseWithResolvers<ITaskSummary | undefined>>();
    const taskEvents = new Emitter<ITaskEvent>();
    const foldersChange = new Emitter<void>(); // never fires: the tests keep their folders
    const textFileSaved = new Emitter<Uri>();
    const configuration = new InMemoryConfigurationService(
        new ConfigurationRegistry([debugConfiguration]),
        {},
        options.workspaceLaunch === undefined ? {} : { launch: options.workspaceLaunch },
    );
    let id = 0;
    const fixture = {
        contextKeys,
        state,
        configuration,
        shown,
        activated,
        ran,
        answer: undefined as number | undefined,
        checkboxChecked: false,
        folders: options.folders ?? [],
        workbenchState: "folder" as WorkbenchState,
        tasks: [] as ITask[],
        taskExitCode: 0 as number | undefined | "pending",
        markers: [] as IMarker[],
        opened: [] as { resource: string; line?: number; preserveFocus: boolean }[],
        saves: [] as number[],
        variables: NO_VARIABLES,
        viewletOpenings: 0,
        replOpenings: 0,
        replClosings: 0,
        extensions: [] as IExtension[],
        activeEditor: undefined as { resource: string; languageId: string; languageName?: string } | undefined,
        pickLabel: undefined as string | string[] | undefined,
        picks: [] as { placeholder: string; rows: string[] }[],
        confirmAnswer: false,
        confirms: [] as string[],
        installs: [] as (string | undefined)[],
        openedFrames: [] as { frame: string; preserveFocus: boolean; sideBySide: boolean }[],
        saveTextFile: (resource: Uri) => {
            textFileSaved.fire(resource);
        },
        endTask: (label: string, exitCode: number | undefined) => {
            const task = fixture.tasks.find((t) => t._label === label);
            /* v8 ignore start -- test helper: a test ends only the tasks it listed */
            if (task === undefined) throw new Error(`no task ${label}`);
            /* v8 ignore stop */
            taskEvents.fire({ kind: "processEnded", task, terminalId: 1, exitCode });
            taskEvents.fire({ kind: "inactive", task, terminalId: 1 });
            runs.get(label)?.resolve({ exitCode });
        },
    };
    const notifications = {
        show: vi.fn((message: INotificationMessage): INotificationHandle => {
            shown.push(message);
            const handle = { id: ++id, answered: Promise.resolve(message.modal ? fixture.answer : undefined) };
            if (message.checkbox === undefined) return handle;
            const checked = fixture.checkboxChecked;
            return { ...handle, checkboxChecked: () => checked };
        }),
        /* v8 ignore start -- test helper: the slow-task warning is debugTaskRunner.test's */
        dismiss: () => undefined,
        /* v8 ignore stop */
    };
    const workspace = {
        getWorkspace: () => ({ id: "w" as never, folders: fixture.folders }),
        getWorkbenchState: () => fixture.workbenchState,
        onDidChangeWorkspaceFolders: (listener: () => void) => foldersChange.event(listener),
    };
    const configurationManager: IConfigurationManagerPorts = {
        configuration,
        workspace,
        state,
        contextKeys,
        files: {
            readFile: () => Promise.reject(new Error("no file")),
            writeFile: () => Promise.resolve({} as never),
            exists: () => Promise.resolve(true),
            /* v8 ignore start -- test helper: the launch.json is never created here */
            createFolder: () => Promise.resolve({} as never),
            /* v8 ignore stop */
        },
        openEditor: (resource, { preserveFocus, line }) => {
            fixture.opened.push({ resource: resource.toString(), line, preserveFocus });
            return Promise.resolve();
        },
        userSettings: {
            resource: USER_SETTINGS,
            open: () => {
                fixture.opened.push({ resource: USER_SETTINGS.toString(), preserveFocus: false });
                return Promise.resolve();
            },
        },
        extensions: {
            get extensions() {
                return fixture.extensions;
            },
            whenInstalledExtensionsRegistered: () => Promise.resolve(),
        },
        pickLate: async (placeholder, items) => pick(placeholder, await items),
    };
    function pick<T extends QuickPickItem>(placeholder: string, items: readonly T[]): T | undefined {
        fixture.picks.push({ placeholder, rows: pickRows(items) });
        const label = Array.isArray(fixture.pickLabel) ? fixture.pickLabel.shift() : fixture.pickLabel;
        return items.find((item) => item.label === label);
    }
    const tasks: IDebugTaskRunnerPorts = {
        tasks: {
            groupedTasks: () => Promise.resolve(fixture.tasks),
            // The tests here name their tasks by label; definitions are debugTaskRunner.test's.
            taskIdentifierOf: (arg: unknown) => arg as string,
            findTask: (all, identifier) => all.find((task) => taskMatches(task, identifier)),
            run: (task) => {
                ran.push(task._label);
                const run = Promise.withResolvers<ITaskSummary | undefined>();
                runs.set(task._label, run);
                taskEvents.fire({ kind: "start", task, terminalId: 1, resolvedDefinition: {} });
                taskEvents.fire({ kind: "active", task, terminalId: 1 });
                if (fixture.taskExitCode !== "pending") {
                    fixture.endTask(task._label, fixture.taskExitCode);
                }
                return run.promise;
            },
            terminate: (task) => {
                fixture.endTask(task._label, undefined);
                return Promise.resolve(true);
            },
            getActiveTasks: () => [],
            onDidStateChange: taskEvents.event,
        },
        markers: { read: () => fixture.markers },
        configuration,
        notifications,
        state,
        /* v8 ignore start -- test helper: these answers of the task errors are debugTaskRunner.test's */
        openProblemsView: () => undefined,
        configureTask: () => Promise.resolve(),
        /* v8 ignore stop */
    };
    const ports: IDebugServicePorts = {
        contextKeys,
        state,
        textFiles: NO_DIRTY_FILES,
        logger: NULL_LOGGER,
        notifications,
        extensions: {
            activateByEvent: (event) => {
                activated.push(event);
                return Promise.resolve();
            },
            whenInstalledExtensionsRegistered: () => {
                activated.push("<registered>");
                return Promise.resolve();
            },
        },
        workspace,
        replConfiguration: () => ({
            collapseIdenticalLines: configuration.get("debug.console.collapseIdenticalLines"),
            maximumLines: configuration.get("debug.console.maximumLines"),
        }),
        configurationManager,
        tasks,
        saveAllBeforeStart: () => {
            fixture.saves.push(fixture.saves.length);
            return Promise.resolve();
        },
        terminalLauncher: NO_TERMINAL_LAUNCHER,
        variables: (folder, config, variables) => fixture.variables(folder, config, variables),
        debugConfiguration: () => ({
            openDebug: configuration.get("debug.openDebug"),
            autoExpandLazyVariables: configuration.get("debug.autoExpandLazyVariables"),
            internalConsoleOptions: configuration.get("debug.internalConsoleOptions"),
            console: { closeOnEnd: configuration.get("debug.console.closeOnEnd") },
            allowBreakpointsEverywhere: configuration.get("debug.allowBreakpointsEverywhere"),
            focusEditorOnBreak: configuration.get("debug.focusEditorOnBreak"),
            showSubSessionsInToolBar: configuration.get("debug.showSubSessionsInToolBar"),
        }),
        guess: {
            activeLanguage: () =>
                fixture.activeEditor && {
                    id: fixture.activeEditor.languageId,
                    name: fixture.activeEditor.languageName,
                },
            pick: (items, placeholder) => Promise.resolve(pick(placeholder, items)),
            confirm: (message) => {
                fixture.confirms.push(message);
                return Promise.resolve(fixture.confirmAnswer);
            },
            installDebuggers: (query) => {
                fixture.installs.push(query);
            },
        },
        activeEditorResource: () => fixture.activeEditor?.resource,
        openViewlet: () => {
            fixture.viewletOpenings++;
        },
        openRepl: () => {
            fixture.replOpenings++;
        },
        closeRepl: () => {
            fixture.replClosings++;
        },
        openStackFrame: (stackFrame, options) => {
            fixture.openedFrames.push({
                frame: `${stackFrame.name}@${String(stackFrame.range.startLineNumber)}`,
                ...options,
            });
            return Promise.resolve();
        },
        onDidSaveTextFile: (listener) => textFileSaved.event(listener),
    };
    return Object.assign(fixture, { ports, service: new DebugService(ports) });
}
