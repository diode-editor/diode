import { DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import {
    type IWireSecretKeys,
    type IWireSecretRef,
    type IWireSecretValue,
    parseWireSecretKeysRequest,
    parseWireSecretRef,
    parseWireSecretWrite,
} from "../../../../api/common/wireTypes.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";
import type { IExtensionSecretStore } from "../extensionSecretsStore.ts";

/**
 * `ExtensionContext.secrets`: субпроцесс не хранит ничего сам, а ходит сюда
 * запросами — хранилище знает только хост (он владеет user-data).
 *
 * Ни одна из этих веток НЕ логируется: в параметрах едет значение секрета, и
 * даже пара «расширение + ключ» рядом с ним в логе — уже утечка. Ошибки
 * формы отдаём исключением (RPC превратит его в reject у расширения),
 * ошибки самого хранилища — его собственным `onError` (туда уходят путь и
 * причина, но никогда значение).
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
                // `null`, а не отсутствие поля: `undefined` через JSON не ездит.
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
                // Событие — и на удаление: в эталоне `onDidChange` описывает факт
                // изменения секрета, а не только его появление.
                rpc.notify("secrets.changed", { extensionId: ref.extensionId, key: ref.key });
                return null;
            }),
        );
        return store;
    }
}

/**
 * Адрес секрета из параметров запроса или исключение. Сообщение НЕ содержит
 * самих параметров: в соседнем поле того же объекта ездит значение секрета.
 */
function requireSecretRef(raw: unknown, method: string): IWireSecretRef {
    const ref = parseWireSecretRef(raw);
    if (ref === null) throw new Error(`${method}: expected { extensionId, key } of non-empty strings`);
    return ref;
}
