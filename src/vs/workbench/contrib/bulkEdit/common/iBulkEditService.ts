import type { BulkEdit } from "./workspaceEdit.ts";

export interface IBulkEditService {
    /**
     * `false` — NOTHING was applied. `respectAutoSaveConfig` (upstream `IBulkEditOptions`) — affected
     * dirty buffers are saved per `files.refactoring.autoSave`.
     */
    applyWorkspaceEdit(edits: BulkEdit, label: string, options?: { respectAutoSaveConfig?: boolean }): Promise<boolean>;
}
