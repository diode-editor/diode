import type { BulkEdit } from "./workspaceEdit.ts";

/**
 * Исполнитель `workspace.applyEdit` с точки зрения потребителя — ровно
 * столько, сколько нужно host-адаптеру расширений (реализация живёт в
 * node-слое: текстовые правки закрытых файлов идут через файловую систему).
 */
export interface IBulkEditService {
    /**
     * Применяет упорядоченный набор правок. `false` — не применено НИЧЕГО
     * (all-or-nothing); `label` — метка шага в истории отмены.
     */
    applyWorkspaceEdit(edits: BulkEdit, label: string): boolean;
}
