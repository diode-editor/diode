import * as path from "node:path";

import { workspaceConfigFilePath } from "../../workspace/common/workspaceConfigFolder.ts";

import type { ConfigurationScope } from "./configurationRegistry.ts";

/** У эталона — `.vscode/settings.json` (`FOLDER_SETTINGS_PATH`). */
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

/** У окна из `.code-workspace` `window`-ключи берутся из файла воркспейса, а не папки. */
export const FOLDER_SCOPES: readonly ConfigurationScope[] = ["resource", "language-overridable", "machine-overridable"];

/** Что именованный профиль берёт из Default: свойство установки, одно на все профили. */
export const APPLICATION_SCOPES: readonly ConfigurationScope[] = ["application"];

/** `application`-ключ в файле профиля не действует — он пишется в `User/settings.json`. */
export const PROFILE_SCOPES: readonly ConfigurationScope[] = [
    "machine",
    "window",
    "resource",
    "language-overridable",
    "machine-overridable",
];

/** Незарегистрированный ключ (`undefined`) — можно. */
export function isWorkspaceScope(scope: ConfigurationScope | undefined): boolean {
    return scope === undefined || WORKSPACE_SCOPES.includes(scope);
}

/** Формулировка `ERROR_NO_WORKSPACE_OPENED` эталона. */
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
