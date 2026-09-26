import type * as vscode from "vscode";

import type { RpcEndpoint } from "./rpcEndpoint.ts";
import { EventEmitter } from "./vscodeTypes.ts";
import { parseWireSecretKeys, parseWireSecretRef, parseWireSecretValue } from "./wireTypes.ts";

/**
 * `ExtensionContext.secrets` поверх хранилища хоста.
 *
 * Почему не локально, как `extensionMemento`: секреты обязаны переживать
 * перезапуск редактора (в них лежат токены сервисов — расширение спрашивает их
 * у человека ОДИН раз), а раскладку user-data знает только хост — субпроцессу
 * её выдумывать из env нельзя (та же причина, что у `extensionStoragePaths`).
 * Поэтому здесь только провод: каждый вызов — RPC-запрос к хосту.
 *
 * Лоток у каждого расширения свой: адрес секрета на проводе — пара
 * «id расширения + ключ», и один `SecretStorage` подставляет свой id сам.
 * `onDidChange` приходит от хоста (`secrets.changed`) и на СВОИ записи тоже —
 * как в эталоне, где событие описывает факт изменения, а не его источника.
 */
export interface IExtensionSecretsFactory {
    /** `ExtensionContext.secrets` для одного расширения. */
    create(extensionId: string): vscode.SecretStorage;
}

/**
 * Один диспетчер на субпроцесс: `secrets.changed` — общее уведомление, а
 * слушатели у каждого расширения свои, поэтому обработчик регистрируется здесь
 * один раз и разводит событие по id.
 */
export function createExtensionSecretsFactory(rpc: RpcEndpoint): IExtensionSecretsFactory {
    const emitters = new Map<string, EventEmitter<vscode.SecretStorageChangeEvent>>();

    rpc.handleNotification("secrets.changed", (params) => {
        const ref = parseWireSecretRef(params);
        if (ref === null) return;
        // Расширение могло ни разу не трогать секреты — эмиттера просто нет.
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
            } as unknown as vscode.SecretStorage;
        },
    };
}
