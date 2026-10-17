import type { BulkEdit } from "./workspaceEdit.ts";

/**
 * Исполнитель `workspace.applyEdit` с точки зрения потребителя — ровно
 * столько, сколько нужно host-адаптеру расширений (реализация —
 * `WorkspaceEditService`: текстовые правки закрытых файлов идут через
 * файловый сервис, поэтому ответ асинхронный).
 */
export interface IBulkEditService {
    /**
     * Применяет упорядоченный набор правок. `false` — не применено НИЧЕГО
     * (all-or-nothing); `label` — метка шага в истории отмены.
     * `respectAutoSaveConfig` — правка-рефакторинг: затронутые грязные буферы
     * сохраняются по `files.refactoring.autoSave` (опция эталона
     * `IBulkEditOptions.respectAutoSaveConfig`).
     */
    applyWorkspaceEdit(edits: BulkEdit, label: string, options?: { respectAutoSaveConfig?: boolean }): Promise<boolean>;
}
