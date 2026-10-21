import * as crypto from "node:crypto";
import * as path from "node:path";

import type { WorkspaceId } from "./iWorkspaceContextService.ts";

/** Id стора, а не воркспейса (`UNKNOWN_EMPTY_WINDOW_WORKSPACE` эталона): `IWorkspace.id` пустого окна по-прежнему `null`. */
export const EMPTY_WINDOW_WORKSPACE_ID: WorkspaceId = "empty-window";

/** `sha256` абсолютного пути — формат, уже лежащий у пользователей на диске; смена формулы = миграция каталогов. */
export function computeWorkspaceId(workspacePath: string): WorkspaceId {
    return crypto.createHash("sha256").update(path.resolve(workspacePath)).digest("hex");
}
