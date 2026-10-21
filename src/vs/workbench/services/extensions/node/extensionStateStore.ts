import type { IStateDescriptor, IStateService } from "../../../../platform/state/common/iStateService.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";

export type ExtensionMementoValue = Readonly<Record<string, unknown>>;

/** `shared` — `globalState` (scope `global`), иначе `workspaceState`. */
export interface IExtensionStateStore {
    get(extensionId: string, shared: boolean): ExtensionMementoValue;
    /** Пустой словарь удаляет запись: файл не копит `{}` от каждого расширения. */
    set(extensionId: string, shared: boolean, value: ExtensionMementoValue): void;
}

/** Префикс страхует от пересечения с `workbench.*`; совместимость с vscode не нужна — файл машинный. */
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

export function createTransientExtensionStateStore(): IExtensionStateStore {
    return createExtensionStateStore(NULL_STATE_SERVICE);
}
