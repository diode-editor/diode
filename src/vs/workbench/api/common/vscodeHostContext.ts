import type { IExtHostDisk } from "./extHostDisk.ts";
import type { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import type { SubprocessRpc } from "./extHostProtocol.ts";
import type { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

/**
 * Id of the extension on whose behalf a creating API call runs SYNCHRONOUSLY: the `vscode` object
 * is shared, and the extension overlay wraps such members in {@link runAs}. An async continuation
 * does not see the owner — and must not.
 */
export class ExtensionOwner {
    private id: string | undefined;

    public get current(): string | undefined {
        return this.id;
    }

    /** `undefined` means "nobody's": a shim object created inside an extension call but not owned by it (the `setStatusBarMessage` item). */
    public runAs<T>(id: string | undefined, fn: () => T): T {
        const previous = this.id;
        this.id = id;
        try {
            return fn();
        } finally {
            this.id = previous;
        }
    }
}

export interface IVscodeHostContext {
    readonly rpc: SubprocessRpc;
    readonly registry: DocumentRegistry;
    /** The only entry point for text into {@link registry}. */
    readonly documentSync: DocumentSyncTracker;
    readonly configStore: WorkspaceConfigStore;
    readonly disk: IExtHostDisk;
    readonly owner: ExtensionOwner;
}
