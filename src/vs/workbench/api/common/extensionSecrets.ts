import type * as vscode from "vscode";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import { EventEmitter } from "./vscodeTypes.ts";
import { parseWireSecretKeys, parseWireSecretRef, parseWireSecretValue } from "./wireTypes.ts";

/**
 * Through the host, not locally like `extensionMemento`: secrets must survive
 * a restart, and only the host knows the user-data layout. `onDidChange` fires
 * for our own writes too, as upstream.
 */
export interface IExtensionSecretsFactory {
    create(extensionId: string): vscode.SecretStorage;
}

export function createExtensionSecretsFactory(rpc: SubprocessRpc): IExtensionSecretsFactory {
    const emitters = new Map<string, EventEmitter<vscode.SecretStorageChangeEvent>>();

    rpc.handleNotification("secrets.changed", (params) => {
        const ref = parseWireSecretRef(params);
        if (ref === null) return;
        emitters.get(ref.extensionId)?.fire({ key: ref.key });
    });

    return {
        create(extensionId: string): vscode.SecretStorage {
            let emitter = emitters.get(extensionId);
            if (emitter === undefined) {
                emitter = new EventEmitter<vscode.SecretStorageChangeEvent>();
                emitters.set(extensionId, emitter);
            }
            return {
                keys: async (): Promise<string[]> =>
                    parseWireSecretKeys(await rpc.request("secrets.keys", { extensionId })),
                get: async (key: string): Promise<string | undefined> =>
                    parseWireSecretValue(await rpc.request("secrets.get", { extensionId, key })),
                store: async (key: string, value: string): Promise<void> => {
                    await rpc.request("secrets.store", { extensionId, key, value });
                },
                delete: async (key: string): Promise<void> => {
                    await rpc.request("secrets.delete", { extensionId, key });
                },
                onDidChange: emitter.event,
            };
        },
    };
}
