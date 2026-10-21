/** Локальный словарь (поэтому `get`/`keys` синхронны), хранилище — на хосте: `update` отдаёт ему словарь целиком. */
export interface IExtensionMemento {
    keys(): readonly string[];
    get(key: string, defaultValue?: unknown): unknown;
    update(key: string, value: unknown): Promise<void>;
    setKeysForSync?(keys: readonly string[]): void;
}

export interface IExtensionMementoOptions {
    readonly initial: Readonly<Record<string, unknown>>;
    /** No-op `setKeysForSync` — только у globalState: расширения зовут его без проверки, Settings Sync у нас нет. */
    readonly withSync: boolean;
    /** Промис `update` резолвится по ответу хоста. */
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
