import { DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import type {
    IEnvironmentVariableCollectionStore,
    IEnvironmentVariableCollectionWithPersistence,
} from "../../../../../platform/terminal/common/environmentVariable.ts";
import type { HostRpc } from "../../../../api/common/extHostProtocol.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";
import { parseWireSetEnvironmentVariableCollection } from "../hostWireParsers.ts";

export function createInMemoryEnvironmentVariableCollectionStore(): IEnvironmentVariableCollectionStore {
    const collections = new Map<string, IEnvironmentVariableCollectionWithPersistence>();
    return {
        collections,
        set: (id, collection) => {
            collections.set(id, collection);
        },
        delete: (id) => {
            collections.delete(id);
        },
    };
}

/**
 * Part of upstream `MainThreadTerminalService`: when the subprocess comes up, the whole store goes to it
 * as a seed — the extension sees the collection as it was before the subprocess died.
 */
export class EnvironmentVariableCollectionsCustomer implements IExtensionHostCustomer {
    private rpc: HostRpc | null = null;

    public constructor(private readonly store: IEnvironmentVariableCollectionStore) {}

    public attach({ rpc }: IExtensionHostContext): IDisposable {
        this.rpc = rpc;
        const store = new DisposableStore();
        store.add(
            rpc.handleNotification("terminal.setEnvironmentVariableCollection", (params): void => {
                const update = parseWireSetEnvironmentVariableCollection(params);
                // Stryker disable next-line ConditionalExpression: equivalent — without the `null` check it throws on `.collection` before writing to the store, RpcEndpoint swallows the notification exception, the observable result is the same “ignored”
                if (update === null) return;
                if (update.collection.length === 0) {
                    this.store.delete(update.extensionId);
                    return;
                }
                this.store.set(update.extensionId, {
                    persistent: update.persistent,
                    map: new Map(update.collection),
                    descriptionMap: new Map(update.description),
                });
            }),
        );
        store.add({
            dispose: () => {
                this.rpc = null;
            },
        });
        return store;
    }

    /** Empty store — no seed (like upstream). */
    public pushInitialState(): void {
        if (this.rpc === null || this.store.collections.size === 0) return;
        this.rpc.notify("terminal.initEnvironmentVariableCollections", {
            collections: [...this.store.collections].map(([id, collection]) => [id, [...collection.map.entries()]]),
        });
    }
}
