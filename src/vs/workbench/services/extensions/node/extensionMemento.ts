/**
 * `vscode.Memento` для `ExtensionContext.globalState` / `workspaceState` на
 * стороне субпроцесса: локальный словарь (поэтому `get`/`keys` синхронны), а
 * хранилище — на хосте (`extensionStateStore.ts`). Начальный словарь приезжает
 * в параметрах `host.activateExtension`, каждый `update` отдаёт хосту словарь
 * целиком (`persist`) — memento переживает перезапуск редактора.
 */
export interface IExtensionMemento {
    keys(): readonly string[];
    get(key: string, defaultValue?: unknown): unknown;
    update(key: string, value: unknown): Promise<void>;
    /** Только у globalState (см. {@link createExtensionMemento}). */
    setKeysForSync?(keys: readonly string[]): void;
}

export interface IExtensionMementoOptions {
    /** Словарь, сохранённый с прошлых запусков. */
    readonly initial: Readonly<Record<string, unknown>>;
    /**
     * Добавить no-op `setKeysForSync` — он есть ТОЛЬКО у globalState
     * (`Memento & { setKeysForSync }` в vscode API), и расширения зовут его без
     * проверки на существование. Settings Sync у нас нет — синхронизировать
     * нечего.
     */
    readonly withSync: boolean;
    /** Отдать хосту словарь целиком; промис `update` резолвится по его ответу. */
    persist(value: Record<string, unknown>): Promise<void>;
}

export function createExtensionMemento(options: IExtensionMementoOptions): IExtensionMemento {
    const store = new Map<string, unknown>(Object.entries(options.initial));
    const memento: IExtensionMemento = {
        keys: () => [...store.keys()],
        get: (key, defaultValue) => (store.has(key) ? store.get(key) : defaultValue),
        update: (key, value) => {
            // Семантика vscode: update(key, undefined) удаляет ключ.
            if (value === undefined) store.delete(key);
            else store.set(key, value);
            return options.persist(Object.fromEntries(store));
        },
    };
    if (options.withSync) {
        memento.setKeysForSync = () => undefined;
    }
    return memento;
}
