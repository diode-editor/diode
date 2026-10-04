import type { IWireDocumentSyncSnapshot } from "./wireTypes.ts";

/**
 * Тонкий «port» приёмника document sync (core → host), нужный
 * `bindDocumentSync`: продюсеру хватает трёх пушей, а знать сам
 * `ExtensionHost` (слой node) браузерному адаптеру незачем. Паттерн повторяет
 * {@link IExtensionFileWatcher}.
 */
export interface IDocumentSyncTarget {
    /** Документ открыт (`editor.didOpen` → `workspace.textDocuments`). */
    didOpenTextDocument(snapshot: IWireDocumentSyncSnapshot): void;
    /** Документ изменился (`editor.didChange`); коалесинг — забота приёмника. */
    didChangeTextDocument(snapshot: IWireDocumentSyncSnapshot): void;
    /** Закрыта последняя вкладка документа (`editor.didClose`). */
    didCloseTextDocument(uri: string): void;
}
