import type { IStateDescriptor, IStateService } from "../../../../platform/state/common/iStateService.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";

/** Словарь memento одного расширения: ключ → значение (JSON-сериализуемое). */
export type ExtensionMementoValue = Readonly<Record<string, unknown>>;

/**
 * Хранилище `ExtensionContext.globalState` / `workspaceState` на стороне ХОСТА
 * — тонкая обёртка над {@link IStateService}: memento расширения переживает
 * перезапуск, как и состояние самого workbench'а (debounce + `flushSync` на
 * выходе). `shared` — `globalState` (scope `global`), иначе `workspaceState`
 * (scope `workspace`: стор открытого проекта или пустого окна).
 *
 * Отличие от секретов (`extensionSecretsStore.ts`): те — отдельный файл 0600 с
 * синхронной записью и запретом логирования; memento — обычное машинное
 * состояние.
 */
export interface IExtensionStateStore {
    get(extensionId: string, shared: boolean): ExtensionMementoValue;
    /** Пустой словарь удаляет запись: файл не копит `{}` от каждого расширения. */
    set(extensionId: string, shared: boolean, value: ExtensionMementoValue): void;
}

/**
 * Дескриптор memento расширения. Префикс `extensionState/` страхует от
 * пересечения с ключами workbench'а (`workbench.*`); совместимость формата с
 * vscode не нужна — файл машинный.
 */
export function extensionStateDescriptor(
    extensionId: string,
    shared: boolean,
): IStateDescriptor<ExtensionMementoValue> {
    return { key: `extensionState/${extensionId}`, scope: shared ? "global" : "workspace", default: {} };
}

export function createExtensionStateStore(state: IStateService): IExtensionStateStore {
    return {
        get: (extensionId, shared) => state.get(extensionStateDescriptor(extensionId, shared)),
        set: (extensionId, shared, value) => {
            const descriptor = extensionStateDescriptor(extensionId, shared);
            if (Object.keys(value).length === 0) state.remove(descriptor);
            else state.store(descriptor, value);
        },
    };
}

/**
 * Хранилище без персиста (дефолт хоста в тестах и харнессах): начальные словари
 * пусты, записи никуда не уходят — memento живёт в памяти субпроцесса.
 */
export function createTransientExtensionStateStore(): IExtensionStateStore {
    return createExtensionStateStore(NULL_STATE_SERVICE);
}
