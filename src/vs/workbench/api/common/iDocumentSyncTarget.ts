import type { IWireDocumentChangedEvent, IWireDocumentSyncSnapshot } from "./wireTypes.ts";

/** Порт: браузерному адаптеру незачем знать `ExtensionHost` (слой node). */
export interface IDocumentSyncTarget {
    didOpenTextDocument(snapshot: IWireDocumentSyncSnapshot): void;
    /** Flush: полный снапшот. */
    didChangeTextDocument(snapshot: IWireDocumentSyncSnapshot): void;
    /** Дельтой, синхронно, на каждый батч. */
    didChangeTextDocumentContent(event: IWireDocumentChangedEvent): void;
    didCloseTextDocument(uri: string): void;
}
