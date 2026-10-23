import type { IWireDocumentChangedEvent } from "./wireTypes.ts";

/**
 * A document as the sync reads it at send time. The text is built only when it is actually sent: for a live
 * subprocess and a document within the sync limit, which is decided on {@link length} — like upstream
 * `isTooLargeForSyncing`, which looks at the buffer length, not at a built string.
 */
export interface IDocumentSyncSource {
    readonly uri: string;
    readonly languageId: string;
    /** The model's `versionId`. */
    readonly version: number;
    readonly isDirty: boolean;
    /** Characters of the LF-normalized text, without building it. */
    readonly length: number;
    /** LF-normalized, like `IWireDocumentSyncSnapshot.text`. */
    getText(): string;
}

/** Port: the browser adapter has no business knowing `ExtensionHost` (node layer). */
export interface IDocumentSyncTarget {
    didOpenTextDocument(source: IDocumentSyncSource): void;
    /** Flush: full snapshot. */
    didChangeTextDocument(source: IDocumentSyncSource): void;
    /** As a delta, synchronously, on every batch. */
    didChangeTextDocumentContent(event: IWireDocumentChangedEvent): void;
    didCloseTextDocument(uri: string): void;
}
