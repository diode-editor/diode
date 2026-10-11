import * as path from "node:path";

import { workspaceConfigFilePath } from "../../workspace/common/workspaceConfigFolder.ts";

import type { ConfigurationScope } from "./configurationRegistry.ts";

/**
 * Слой настроек воркспейса: что и откуда читаем.
 *
 * Эталон в однопапочном окне держит в слое `workspace` файл
 * `<папка>/.vscode/settings.json` (`FOLDER_SETTINGS_PATH`,
 * `workbench/services/configuration/common/configuration.ts`). У нас каталог
 * свой — `.diode/` (`workspaceConfigFolder.ts`). Слой лежит выше профиля: проект уточняет
 * настройки человека, а не наоборот. Фильтр ключей по `scope` —
 * `filterWorkspaceSettings` в `configurationValidation.ts`.
 *
 * Окно, открытое файлом `.code-workspace`, раскладывает так же, как эталон:
 * слой воркспейса — блок `settings` файла (`WORKSPACE_SCOPES`), а
 * `.diode/settings.json` папки — слой папки поверх него (`FOLDER_SCOPES`).
 */

/** Файл настроек воркспейса относительно папки (у эталона — `.vscode/settings.json`). */
export const WORKSPACE_SETTINGS_PATH = workspaceConfigFilePath("settings.json");

/** Абсолютный путь к settings.json воркспейса для папки `folderPath`. */
export function workspaceSettingsPath(folderPath: string): string {
    return path.join(folderPath, WORKSPACE_SETTINGS_PATH);
}

/**
 * Скоупы, которые разрешено переопределять в воркспейсе (`WORKSPACE_SCOPES`
 * эталона). `application` и `machine` — свойства человека и машины, проект их
 * не задаёт.
 */
export const WORKSPACE_SCOPES: readonly ConfigurationScope[] = [
    "window",
    "resource",
    "language-overridable",
    "machine-overridable",
];

/**
 * Скоупы, которые принимает слой папки (`FOLDER_SCOPES` эталона), когда окно
 * открыто файлом `.code-workspace`: `.diode/settings.json` папки тогда
 * уточняет только то, что зависит от ресурса и языка, а `window`-ключи берутся
 * из файла воркспейса.
 */
export const FOLDER_SCOPES: readonly ConfigurationScope[] = ["resource", "language-overridable", "machine-overridable"];

/** Можно ли держать ключ с таким `scope` в слое воркспейса; незарегистрированный ключ (`undefined`) — можно. */
export function isWorkspaceScope(scope: ConfigurationScope | undefined): boolean {
    return scope === undefined || WORKSPACE_SCOPES.includes(scope);
}

/** Отказ записи в воркспейс без открытой папки (`ERROR_NO_WORKSPACE_OPENED` эталона, формулировка его же). */
export const NO_WORKSPACE_OPENED_ERROR =
    "Unable to write to Workspace Settings because no workspace is opened. Please open a workspace first and try again.";

/**
 * Отказ записи ключа чужого скоупа в настройки папки
 * (`ERROR_INVALID_FOLDER_CONFIGURATION` эталона): текст ошибки либо `null`.
 */
export function folderScopeWriteError(key: string, scope: ConfigurationScope | undefined): string | null {
    if (scope === undefined || FOLDER_SCOPES.includes(scope)) return null;
    return `Unable to write to Folder Settings because ${key} does not support the folder resource scope.`;
}

/**
 * Отказ записи ключа чужого скоупа в воркспейс
 * (`ERROR_INVALID_WORKSPACE_CONFIGURATION_APPLICATION`/`…_MACHINE` эталона):
 * текст ошибки либо `null`, если ключ в воркспейс писать можно.
 */
export function workspaceScopeWriteError(key: string, scope: ConfigurationScope | undefined): string | null {
    if (isWorkspaceScope(scope)) return null;
    return `Unable to write ${key} to Workspace Settings. This setting can be written only into User settings.`;
}
