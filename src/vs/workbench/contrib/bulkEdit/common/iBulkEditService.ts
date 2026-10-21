import type { BulkEdit } from "./workspaceEdit.ts";

export interface IBulkEditService {
    /**
     * `false` — не применено НИЧЕГО. `respectAutoSaveConfig` (эталон `IBulkEditOptions`) — затронутые
     * грязные буферы сохраняются по `files.refactoring.autoSave`.
     */
    applyWorkspaceEdit(edits: BulkEdit, label: string, options?: { respectAutoSaveConfig?: boolean }): Promise<boolean>;
}
