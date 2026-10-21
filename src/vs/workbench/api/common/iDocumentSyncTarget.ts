import type { IWireDocumentChangedEvent, IWireDocumentSyncSnapshot } from "./wireTypes.ts";

/** Port: the browser adapter has no business knowing `ExtensionHost` (node layer). */
export interface IDocumentSyncTarget {
    didOpenTextDocument(snapshot: IWireDocumentSyncSnapshot): void;
    /** Flush: full snapshot. */
    didChangeTextDocument(snapshot: IWireDocumentSyncSnapshot): void;
    /** As a delta, synchronously, on every batch. */
    didChangeTextDocumentContent(event: IWireDocumentChangedEvent): void;
    didCloseTextDocument(uri: string): void;
}
