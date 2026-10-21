import { DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import {
    type IWireSecretKeys,
    type IWireSecretRef,
    type IWireSecretValue,
    parseWireSecretRef,
} from "../../../../api/common/wireTypes.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";
import type { IExtensionSecretStore } from "../extensionSecretsStore.ts";
import { parseWireSecretKeysRequest, parseWireSecretWrite } from "../hostWireParsers.ts";

/**
 * None of these branches log: the params carry the secret value, and
 * even the “extension + key” pair next to it in the log is already a leak.
 */
export class SecretsCustomer implements IExtensionHostCustomer {
    public constructor(private readonly secrets: IExtensionSecretStore) {}

    public attach({ rpc }: IExtensionHostContext): IDisposable {
        const store = new DisposableStore();
        store.add(
            rpc.handleRequest("secrets.keys", (params): IWireSecretKeys => {
                const extensionId = parseWireSecretKeysRequest(params);
                if (extensionId === null) throw new Error("secrets.keys: extensionId must be a non-empty string");
                return { keys: [...this.secrets.keys(extensionId)] };
            }),
        );
        store.add(
            rpc.handleRequest("secrets.get", (params): IWireSecretValue => {
                const ref = requireSecretRef(params, "secrets.get");
                // `null` rather than a missing field: `undefined` doesn't travel through JSON.
                return { value: this.secrets.get(ref.extensionId, ref.key) ?? null };
            }),
        );
        store.add(
            rpc.handleRequest("secrets.store", (params): null => {
                const write = parseWireSecretWrite(params);
                if (write === null) throw new Error("secrets.store: expected { extensionId, key, value } of strings");
                this.secrets.store(write.extensionId, write.key, write.value);
                rpc.notify("secrets.changed", { extensionId: write.extensionId, key: write.key });
                return null;
            }),
        );
        store.add(
            rpc.handleRequest("secrets.delete", (params): null => {
                const ref = requireSecretRef(params, "secrets.delete");
                this.secrets.delete(ref.extensionId, ref.key);
                // On delete too: upstream `onDidChange` means a change, not only an addition.
                rpc.notify("secrets.changed", { extensionId: ref.extensionId, key: ref.key });
                return null;
            }),
        );
        return store;
    }
}

/** The message has NO params: the secret value travels in a sibling field of the same object. */
function requireSecretRef(raw: unknown, method: string): IWireSecretRef {
    const ref = parseWireSecretRef(raw);
    if (ref === null) throw new Error(`${method}: expected { extensionId, key } of non-empty strings`);
    return ref;
}
