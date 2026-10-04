import type { IWireDocumentChangedEvent, IWireDocumentSyncSnapshot } from "./wireTypes.ts";

/**
 * Тонкий «port» приёмника document sync (core → host), нужный
 * `bindDocumentSync`: продюсеру хватает трёх пушей, а знать сам
 * `ExtensionHost` (слой node) браузерному адаптеру незачем. Паттерн повторяет
 * {@link IExtensionFileWatcher}.
 */
export interface IDocumentSyncTarget {
    /** Документ открыт (`editor.didOpen` → `workspace.textDocuments`). */
    didOpenTextDocument(snapshot: IWireDocumentSyncSnapshot): void;
    /** Содержимое документа заменено целиком (flush): полный снапшот. */
    didChangeTextDocument(snapshot: IWireDocumentSyncSnapshot): void;
    /** Правки модели (`editor.didChange` дельтой) — синхронно, на каждый батч. */
    didChangeTextDocumentContent(event: IWireDocumentChangedEvent): void;
    /** Закрыта последняя вкладка документа (`editor.didClose`). */
    didCloseTextDocument(uri: string): void;
}
