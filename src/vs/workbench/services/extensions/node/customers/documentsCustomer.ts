import { DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import type { ILogger } from "../../../../../platform/log/common/iLogger.ts";
import type { HostRpc } from "../../../../api/common/extHostProtocol.ts";
import type { IDocumentSyncSource, IDocumentSyncTarget } from "../../../../api/common/iDocumentSyncTarget.ts";
import type { IWireDocumentChangedEvent, IWireDocumentSyncSnapshot } from "../../../../api/common/wireTypes.ts";
import type { ISaveEdit, ISaveSnapshot } from "../../../textfile/common/iSaveParticipant.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";
import { requestWillSaveEdits } from "../hostRequests.ts";
import { loggingRequest } from "../requestPolicy.ts";

/**
 * In characters, like upstream `_MODEL_SYNC_LIMIT`. Decided on open (and on full content
 * replacement) from the document's length, before its text is built: a document above the
 * limit doesn't exist for extensions.
 */
export const MAX_SYNCED_DOCUMENT_CHARS = 50 * 1024 * 1024;

export interface IDocumentsCustomerOptions {
    /** In ms. */
    readonly willSaveTimeoutMs: number;
    /** Sources, not snapshots: the seed builds each text right before sending it, one document at a time. */
    readonly openDocumentsProvider: (() => IDocumentSyncSource[]) | undefined;
    readonly maxSyncedDocumentChars: number;
    readonly logger: ILogger | undefined;
}

interface ISpawnDocuments {
    readonly rpc: HostRpc;
    willSaveSubscribed: boolean;
    didSaveSubscribed: boolean;
    /**
     * Edits to a document outside the set aren't sent: applied to someone else's text they would corrupt the
     * mirror.
     */
    readonly synced: Set<string>;
}

/**
 * Edits go out synchronously and without coalescing: message order in the channel replaces the version in the request
 * (like upstream `$acceptModelChanged`).
 */
export class DocumentsCustomer implements IExtensionHostCustomer, IDocumentSyncTarget {
    private live: ISpawnDocuments | null = null;

    public constructor(private readonly options: IDocumentsCustomerOptions) {}

    /** BEFORE the first activation: the stock vscode-languageclient reads `workspace.textDocuments` on start(). */
    public pushInitialState(): void {
        const live = this.live;
        if (live === null) return;
        const openDocuments = this.options.openDocumentsProvider?.() ?? [];
        for (const source of openDocuments) this.didOpenTextDocument(source);
    }

    /** Requests for an unsynced document get an empty reply without RPC: requests don't carry the text. */
    public isSynced(uri: string): boolean {
        return this.live?.synced.has(uri) === true;
    }

    /** The request doesn't carry the document text — the participant reads the mirror. */
    public async willSaveTextDocument(snapshot: ISaveSnapshot): Promise<readonly ISaveEdit[]> {
        const live = this.live;
        if (!live?.willSaveSubscribed || !live.synced.has(snapshot.uri)) return [];
        const rpc = live.rpc;
        return requestWillSaveEdits(
            loggingRequest(rpc, this.options.logger),
            {
                uri: snapshot.uri,
                languageId: snapshot.languageId,
                version: snapshot.versionId,
                isDirty: snapshot.isDirty,
                reason: 1, // TextDocumentSaveReason.Manual
                eol: snapshot.eol,
                encoding: snapshot.encoding,
            },
            this.options.willSaveTimeoutMs,
        );
    }

    public didSaveTextDocument(meta: { uri: string; languageId: string }): void {
        const live = this.live;
        if (!live?.didSaveSubscribed) return;
        live.rpc.notify("workspace.didSaveTextDocument", meta);
    }

    /** The text is read from the source only here, right before it goes out: no subprocess, no text. */
    public didOpenTextDocument(source: IDocumentSyncSource): void {
        const live = this.live;
        if (live === null || !this.fitsDocumentSyncLimit(source)) return;
        live.rpc.notify("editor.didOpen", snapshotOf(source));
        live.synced.add(source.uri);
    }

    /**
     * A synced document that outgrew the limit is closed (the mirror would diverge forever); one that became small
     * enough is opened.
     */
    public didChangeTextDocument(source: IDocumentSyncSource): void {
        const live = this.live;
        if (live === null) return;
        const synced = live.synced.has(source.uri);
        if (this.fitsDocumentSyncLimit(source)) {
            live.rpc.notify(synced ? "editor.didChange" : "editor.didOpen", snapshotOf(source));
            live.synced.add(source.uri);
        } else if (synced) {
            live.synced.delete(source.uri);
            live.rpc.notify("editor.didClose", { uri: source.uri });
        }
    }

    /** No coalescing: a provider request sent right after travels on the same channel after the edits. */
    public didChangeTextDocumentContent(event: IWireDocumentChangedEvent): void {
        const live = this.live;
        if (!live?.synced.has(event.uri)) return;
        live.rpc.notify("editor.didChange", event);
    }

    public didCloseTextDocument(uri: string): void {
        const live = this.live;
        if (!live?.synced.delete(uri)) return;
        live.rpc.notify("editor.didClose", { uri });
    }

    public attach({ rpc }: IExtensionHostContext): IDisposable {
        const live: ISpawnDocuments = {
            rpc,
            willSaveSubscribed: false,
            didSaveSubscribed: false,
            synced: new Set(),
        };
        this.live = live;
        const store = new DisposableStore();
        // Without subscribers the host doesn't run RPC on save (save stays synchronous).
        store.add(
            rpc.handleNotification("workspace.updateSubscriptions", (params) => {
                const p: { willSave?: unknown; didSave?: unknown } = params;
                live.willSaveSubscribed = p.willSave === true;
                live.didSaveSubscribed = p.didSave === true;
            }),
        );
        store.add({
            dispose: () => {
                this.live = null;
            },
        });
        return store;
    }

    private fitsDocumentSyncLimit(source: IDocumentSyncSource): boolean {
        // Quietly: the large-file mode is the user's visible state, not a surprise worth a log line.
        if (source.isTooLargeForTokenization) return false;
        if (source.length <= this.options.maxSyncedDocumentChars) return true;
        this.options.logger?.warn("skipping document sync: document too large", {
            uri: source.uri,
            length: source.length,
        });
        return false;
    }
}

/**
 * One string, not upstream's `IModelAddedData.lines`: measured on the 200k-line bench fixture, the lines cost
 * the main thread more (`getLinesContent` 11 ms + `JSON.stringify` 35 ms vs ~0 + 31 ms for the piece tree's
 * lazily concatenated text) and 200 KB more on the wire, for 6 ms of `split` saved in the subprocess.
 */
function snapshotOf(source: IDocumentSyncSource): IWireDocumentSyncSnapshot {
    return {
        uri: source.uri,
        languageId: source.languageId,
        version: source.version,
        text: source.getText(),
        isDirty: source.isDirty,
    };
}
