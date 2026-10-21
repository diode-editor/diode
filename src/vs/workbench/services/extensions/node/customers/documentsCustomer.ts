import { DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import type { ILogger } from "../../../../../platform/log/common/iLogger.ts";
import type { HostRpc } from "../../../../api/common/extHostProtocol.ts";
import type { IDocumentSyncTarget } from "../../../../api/common/iDocumentSyncTarget.ts";
import type { IWireDocumentChangedEvent, IWireDocumentSyncSnapshot } from "../../../../api/common/wireTypes.ts";
import type { ISaveEdit, ISaveSnapshot } from "../../../textfile/common/iSaveParticipant.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";
import { requestWillSaveEdits } from "../hostRequests.ts";
import { loggingRequest } from "../requestPolicy.ts";

/**
 * In characters, like upstream `_MODEL_SYNC_LIMIT`. Decided on open (and on full content
 * replacement): a document above the limit doesn't exist for extensions.
 */
export const MAX_SYNCED_DOCUMENT_CHARS = 50 * 1024 * 1024;

export interface IDocumentsCustomerOptions {
    /** In ms. */
    readonly willSaveTimeoutMs: number;
    readonly openDocumentsProvider: (() => IWireDocumentSyncSnapshot[]) | undefined;
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
        for (const snapshot of openDocuments) this.didOpenTextDocument(snapshot);
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

    public didOpenTextDocument(snapshot: IWireDocumentSyncSnapshot): void {
        const live = this.live;
        if (live === null || !this.fitsDocumentSyncLimit(snapshot)) return;
        live.rpc.notify("editor.didOpen", snapshot);
        live.synced.add(snapshot.uri);
    }

    /**
     * A synced document that outgrew the limit is closed (the mirror would diverge forever); one that became small
     * enough is opened.
     */
    public didChangeTextDocument(snapshot: IWireDocumentSyncSnapshot): void {
        const live = this.live;
        if (live === null) return;
        const synced = live.synced.has(snapshot.uri);
        if (this.fitsDocumentSyncLimit(snapshot)) {
            live.rpc.notify(synced ? "editor.didChange" : "editor.didOpen", snapshot);
            live.synced.add(snapshot.uri);
        } else if (synced) {
            live.synced.delete(snapshot.uri);
            live.rpc.notify("editor.didClose", { uri: snapshot.uri });
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
                // No `documentSync` flag needed: edits go to all synced documents —
                // skipping any would corrupt the mirror.
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

    private fitsDocumentSyncLimit(snapshot: IWireDocumentSyncSnapshot): boolean {
        if (snapshot.text.length <= this.options.maxSyncedDocumentChars) return true;
        this.options.logger?.warn("skipping document sync: document too large", {
            uri: snapshot.uri,
            length: snapshot.text.length,
        });
        return false;
    }
}
