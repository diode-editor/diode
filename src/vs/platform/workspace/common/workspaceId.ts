import * as crypto from "node:crypto";
import * as path from "node:path";

import type { WorkspaceId } from "./iWorkspaceContextService.ts";

/**
 * Вычисляет {@link WorkspaceId} по пути проекта — папки, открытой напрямую,
 * или файла `.code-workspace`: `sha256` от абсолютного (нормализованного)
 * пути, hex (`workspaceStorage/<hash>/`). Pure, без I/O.
 *
 * Формат намеренно совпадает с тем, что уже лежит у пользователей на диске.
 * Путь файла воркспейса и путь папки не совпадают, так что воркспейс из файла
 * — отдельный проект со своими сторами и без миграции. Когда «один проект»
 * станет набором папок без файла, id начнёт выводиться иначе — миграция
 * будет здесь, в одной функции (см. `docs/TODO/MultiRoot.md`, M8).
 */
/**
 * Идентичность стора состояния ПУСТОГО окна (зеркало
 * `UNKNOWN_EMPTY_WINDOW_WORKSPACE = 'empty-window'` у vscode): workspace-скоуп
 * без открытой папки пишется в `workspaceStorage/empty-window/state.json`, а не
 * в global. Это id стора, а не воркспейса: у пустого окна `IWorkspace.id`
 * по-прежнему `null` (см. `docs/TODO/MultiRoot.md`).
 */
export const EMPTY_WINDOW_WORKSPACE_ID: WorkspaceId = "empty-window";

export function computeWorkspaceId(workspacePath: string): WorkspaceId {
    return crypto.createHash("sha256").update(path.resolve(workspacePath)).digest("hex");
}
