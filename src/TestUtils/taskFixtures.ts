import { expect } from "vitest";

import { Uri } from "../vs/base/common/uri.ts";
import type { IWorkspaceFolder } from "../vs/platform/workspace/common/iWorkspaceContextService.ts";
import { contributedTaskId, createTaskIdentifier } from "../vs/workbench/api/common/taskIdentity.ts";
import {
    DEFAULT_PRESENTATION,
    DEFAULT_RUN_OPTIONS,
    type ICommandConfiguration,
    type IPresentationOptions,
    type IRunOptions,
    type ITask,
    type TaskProblemMatcher,
} from "../vs/workbench/contrib/tasks/common/tasks.ts";
import type { ITaskVariableContext } from "../vs/workbench/contrib/tasks/common/taskVariables.ts";

export const TASK_FOLDER: IWorkspaceFolder = { uri: Uri.file("/ws"), name: "ws", index: 0 };

export interface ITaskFixtureOptions {
    readonly label?: string;
    readonly command?: Partial<Omit<ICommandConfiguration, "presentation">>;
    readonly presentation?: Partial<IPresentationOptions>;
    readonly runOptions?: Partial<IRunOptions>;
    readonly isBackground?: boolean;
    readonly extension?: { readonly type: string; readonly extensionId: string; readonly source: string };
    readonly folder?: IWorkspaceFolder | null;
    readonly detail?: string;
    readonly hide?: boolean;
    readonly definition?: Readonly<Record<string, unknown>>;
    readonly problemMatchers?: readonly TaskProblemMatcher[];
}

export function makeTask(options: ITaskFixtureOptions = {}): ITask {
    const label = options.label ?? "build";
    const folder = options.folder === null ? undefined : (options.folder ?? TASK_FOLDER);
    const runtime = options.command?.runtime ?? "shell";
    const command: ICommandConfiguration = {
        runtime,
        ...(runtime === "custom" ? {} : { name: `echo ${label}`, args: [] }),
        ...options.command,
        presentation: { ...DEFAULT_PRESENTATION, ...options.presentation },
    };
    const extension = options.extension;
    // Key computed as upstream does: commands taking a definition argument find the task by it.
    // Without a schema nothing is reported; a report would mean a broken fixture.
    const keyed =
        extension === undefined
            ? undefined
            : createTaskIdentifier({ type: extension.type, ...options.definition }, undefined, expect.unreachable);
    const id =
        keyed === undefined || extension === undefined
            ? `$core.${label}`
            : contributedTaskId(extension.extensionId, keyed);
    return {
        _id: id,
        _label: extension === undefined ? label : `${extension.source}: ${label}`,
        name: label,
        type: extension?.type ?? runtime,
        source:
            extension === undefined
                ? { kind: "workspace", label: "Workspace", folder: folder ?? TASK_FOLDER }
                : {
                      kind: "extension",
                      label: extension.source,
                      extensionId: extension.extensionId,
                      scope: folder === undefined ? "workspace" : "folder",
                      folder,
                  },
        definition: keyed ?? { type: runtime, _key: id, ...options.definition },
        command,
        isBackground: options.isBackground ?? false,
        ...(options.detail !== undefined ? { detail: options.detail } : {}),
        ...(options.hide !== undefined ? { hide: options.hide } : {}),
        problemMatchers: options.problemMatchers ?? [],
        hasDefinedMatchers: options.problemMatchers !== undefined,
        runOptions: { ...DEFAULT_RUN_OPTIONS, ...options.runOptions },
    };
}

export function taskVariables(overrides: Partial<ITaskVariableContext> = {}): ITaskVariableContext {
    return {
        folderPath: TASK_FOLDER.uri.fsPath,
        filePath: undefined,
        lineNumber: undefined,
        env: {},
        userHome: "/home/u",
        cwd: "/cwd",
        getConfiguration: () => undefined,
        ...overrides,
    };
}
