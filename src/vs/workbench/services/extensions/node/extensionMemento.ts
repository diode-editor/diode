/**
 * Наивный in-memory `vscode.Memento` для `ExtensionContext.globalState` /
 * `workspaceState`: честные get/update/keys в пределах жизни субпроцесса,
 * БЕЗ персистентности — перезапуск редактора начинает с чистого листа.
 * Этого достаточно типовому потребителю (ruff помечает разово показанную
 * рекомендацию: `globalState.get(...)` при активации падал на отсутствии
 * memento вовсе); настоящее хранилище — вместе с `IStateService`-мостом,
 * когда появится потребитель, которому важно переживать перезапуск.
 */
export interface IExtensionMemento {
    keys(): readonly string[];
    get(key: string, defaultValue?: unknown): unknown;
    update(key: string, value: unknown): Promise<void>;
    /** Только у globalState (см. {@link createExtensionMemento}). */
    setKeysForSync?(keys: readonly string[]): void;
}

/**
 * `withSync` добавляет no-op `setKeysForSync` — он есть ТОЛЬКО у globalState
 * (`Memento & { setKeysForSync }` в vscode API), и расширения зовут его без
 * проверки на существование.
 */
export function createExtensionMemento(withSync: boolean): IExtensionMemento {
    const store = new Map<string, unknown>();
    const memento: IExtensionMemento = {
        keys: () => [...store.keys()],
        get: (key, defaultValue) => (store.has(key) ? store.get(key) : defaultValue),
        update: (key, value) => {
            // Семантика vscode: update(key, undefined) удаляет ключ.
            if (value === undefined) store.delete(key);
            else store.set(key, value);
            return Promise.resolve();
        },
    };
    if (withSync) {
        memento.setKeysForSync = () => undefined;
    }
    return memento;
}
