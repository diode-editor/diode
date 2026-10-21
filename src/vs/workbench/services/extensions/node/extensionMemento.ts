/** A local dictionary (hence synchronous `get`/`keys`), stored on the host: `update` sends it the whole dictionary. */
export interface IExtensionMemento {
    keys(): readonly string[];
    get(key: string, defaultValue?: unknown): unknown;
    update(key: string, value: unknown): Promise<void>;
    setKeysForSync?(keys: readonly string[]): void;
}

export interface IExtensionMementoOptions {
    readonly initial: Readonly<Record<string, unknown>>;
    /** No-op `setKeysForSync`, globalState only: extensions call it unchecked, and we have no Settings Sync. */
    readonly withSync: boolean;
    /** The `update` promise resolves on the host's response. */
    persist(value: Record<string, unknown>): Promise<void>;
}

export function createExtensionMemento(options: IExtensionMementoOptions): IExtensionMemento {
    const store = new Map<string, unknown>(Object.entries(options.initial));
    const memento: IExtensionMemento = {
        keys: () => [...store.keys()],
        get: (key, defaultValue) => (store.has(key) ? store.get(key) : defaultValue),
        update: (key, value) => {
            // vscode semantics: update(key, undefined) deletes the key.
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
