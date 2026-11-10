import * as path from "node:path";

import { workspaceConfigFilePath } from "../../workspace/common/workspaceConfigFolder.ts";

import type { ConfigurationScope } from "./configurationRegistry.ts";

/** Upstream uses `.vscode/settings.json` (`FOLDER_SETTINGS_PATH`). */
export const WORKSPACE_SETTINGS_PATH = workspaceConfigFilePath("settings.json");

export function workspaceSettingsPath(folderPath: string): string {
    return path.join(folderPath, WORKSPACE_SETTINGS_PATH);
}

export const WORKSPACE_SCOPES: readonly ConfigurationScope[] = [
    "window",
    "resource",
    "language-overridable",
    "machine-overridable",
];

/** In a `.code-workspace` window, `window` keys come from the workspace file, not the folder. */
export const FOLDER_SCOPES: readonly ConfigurationScope[] = ["resource", "language-overridable", "machine-overridable"];

/** What a named profile takes from Default: a property of the installation, shared by all profiles. */
export const APPLICATION_SCOPES: readonly ConfigurationScope[] = ["application"];

/** An `application` key has no effect in a profile file: it is written to `User/settings.json`. */
export const PROFILE_SCOPES: readonly ConfigurationScope[] = [
    "machine",
    "window",
    "resource",
    "language-overridable",
    "machine-overridable",
];

/** An unregistered key (`undefined`) is allowed. */
export function isWorkspaceScope(scope: ConfigurationScope | undefined): boolean {
    return scope === undefined || WORKSPACE_SCOPES.includes(scope);
}

/** Wording of upstream's `ERROR_NO_WORKSPACE_OPENED`. */
export const NO_WORKSPACE_OPENED_ERROR =
    "Unable to write to Workspace Settings because no workspace is opened. Please open a workspace first and try again.";

export function folderScopeWriteError(key: string, scope: ConfigurationScope | undefined): string | null {
    if (scope === undefined || FOLDER_SCOPES.includes(scope)) return null;
    return `Unable to write to Folder Settings because ${key} does not support the folder resource scope.`;
}

export function workspaceScopeWriteError(key: string, scope: ConfigurationScope | undefined): string | null {
    if (isWorkspaceScope(scope)) return null;
    return `Unable to write ${key} to Workspace Settings. This setting can be written only into User settings.`;
}

/**
 * Upstream `TASKS_CONFIGURATION_KEY`: a standalone section. `tasks.*` is read from and written to its own file
 * (`WORKSPACE_STANDALONE_CONFIGURATIONS`, `USER_STANDALONE_CONFIGURATIONS`), not a settings file.
 */
export const TASKS_CONFIGURATION_KEY = "tasks";

export const TASKS_FILE_NAME = "tasks.json";

/** Upstream `TASKS_DEFAULT`: the content a missing tasks file is created with before the edit. */
export const TASKS_DEFAULT = '{\n\t"version": "2.0.0",\n\t"tasks": []\n}';

/** Wording of upstream's `ERROR_INVALID_CONFIGURATION` for the tasks file. */
export const TASKS_INVALID_CONFIGURATION_ERROR =
    "Unable to write into the tasks configuration file. Please open it to correct errors/warnings in it and try again.";

export function workspaceTasksPath(folderPath: string): string {
    return path.join(folderPath, workspaceConfigFilePath(TASKS_FILE_NAME));
}

/**
 * The JSON path of a `tasks` key inside the tasks file (upstream `getConfigurationEditOperation`): `tasks` is the
 * whole file, `tasks.<x>` is the top-level `<x>`; any other key is not standalone.
 */
export function tasksJsonPath(key: string): string[] | undefined {
    if (key === TASKS_CONFIGURATION_KEY) return [];
    const prefix = `${TASKS_CONFIGURATION_KEY}.`;
    return key.startsWith(prefix) ? [key.slice(prefix.length)] : undefined;
}
