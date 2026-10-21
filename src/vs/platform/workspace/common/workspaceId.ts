import * as crypto from "node:crypto";
import * as path from "node:path";

import type { WorkspaceId } from "./iWorkspaceContextService.ts";

/** A store id, not a workspace id (upstream's `UNKNOWN_EMPTY_WINDOW_WORKSPACE`): an empty window's `IWorkspace.id` is still `null`. */
export const EMPTY_WINDOW_WORKSPACE_ID: WorkspaceId = "empty-window";

/** `sha256` of the absolute path: a format already on users' disks; changing the formula means migrating directories. */
export function computeWorkspaceId(workspacePath: string): WorkspaceId {
    return crypto.createHash("sha256").update(path.resolve(workspacePath)).digest("hex");
}
