import * as path from "node:path";

import type { ConfigurationScope } from "./configurationRegistry.ts";

/**
 * Слой настроек воркспейса: что и откуда читаем.
 *
 * Эталон в однопапочном окне держит в слое `workspace` файл
 * `<папка>/.vscode/settings.json` (`FOLDER_SETTINGS_PATH`,
 * `workbench/services/configuration/common/configuration.ts`). У нас каталог
 * свой — `.diode/`: настройки Diode не должны ни читать, ни перетирать файл
 * VS Code в том же проекте. Слой лежит выше профиля: проект уточняет
 * настройки человека, а не наоборот. Фильтр ключей по `scope` —
 * `filterWorkspaceSettings` в `configurationValidation.ts`.
 */

/** Каталог настроек проекта в корне папки воркспейса (у эталона — `.vscode`). */
export const WORKSPACE_CONFIG_FOLDER_NAME = ".diode";
/** Файл настроек воркспейса относительно папки (у эталона — `.vscode/settings.json`). */
export const WORKSPACE_SETTINGS_PATH = `${WORKSPACE_CONFIG_FOLDER_NAME}/settings.json`;

/** Абсолютный путь к settings.json воркспейса для папки `folderPath`. */
export function workspaceSettingsPath(folderPath: string): string {
    return path.join(folderPath, WORKSPACE_CONFIG_FOLDER_NAME, "settings.json");
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

/** Можно ли держать ключ с таким `scope` в слое воркспейса; незарегистрированный ключ (`undefined`) — можно. */
export function isWorkspaceScope(scope: ConfigurationScope | undefined): boolean {
    return scope === undefined || WORKSPACE_SCOPES.includes(scope);
}

/** Отказ записи в воркспейс без открытой папки (`ERROR_NO_WORKSPACE_OPENED` эталона, формулировка его же). */
export const NO_WORKSPACE_OPENED_ERROR =
    "Unable to write to Workspace Settings because no workspace is opened. Please open a workspace first and try again.";

/**
 * Отказ записи ключа чужого скоупа в воркспейс
 * (`ERROR_INVALID_WORKSPACE_CONFIGURATION_APPLICATION`/`…_MACHINE` эталона):
 * текст ошибки либо `null`, если ключ в воркспейс писать можно.
 */
export function workspaceScopeWriteError(key: string, scope: ConfigurationScope | undefined): string | null {
    if (isWorkspaceScope(scope)) return null;
    return `Unable to write ${key} to Workspace Settings. This setting can be written only into User settings.`;
}
