import type { IExtHostDisk } from "./extHostDisk.ts";
import type { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import type { SubprocessRpc } from "./extHostProtocol.ts";
import type { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

/**
 * Id расширения, от имени которого СИНХРОННО исполняется создающий вызов API: объект `vscode`
 * общий, оверлей расширения оборачивает такие члены в {@link runAs}. Асинхронное продолжение
 * владельца не видит — и не должно.
 */
export class ExtensionOwner {
    private id: string | undefined;

    public get current(): string | undefined {
        return this.id;
    }

    /** `undefined` — «ничей»: объект шима, заведённый внутри вызова расширения, но не его (пункт `setStatusBarMessage`). */
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
    /** Единственная точка входа текста в {@link registry}. */
    readonly documentSync: DocumentSyncTracker;
    readonly configStore: WorkspaceConfigStore;
    readonly disk: IExtHostDisk;
    readonly owner: ExtensionOwner;
}
