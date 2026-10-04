import type { IExtHostDisk } from "./extHostDisk.ts";
import type { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import type { SubprocessRpc } from "./extHostProtocol.ts";
import type { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

/**
 * «Окружающий владелец» — id расширения, от имени которого сейчас СИНХРОННО
 * исполняется создающий вызов API (`createOutputChannel`, `register*Provider`, …).
 *
 * Объект `vscode` общий на все расширения; знание «кто зовёт» приносит оверлей
 * расширения (`extensionApiFactory.ts`): он оборачивает такие члены в
 * {@link runAs}, и общая фабрика может прочитать {@link current} в момент
 * создания. Асинхронное продолжение владельца не видит — и не должно: окно
 * «владелец выставлен» ровно на время синхронного вызова.
 */
export class ExtensionOwner {
    private id: string | undefined;

    /** id расширения внутри {@link runAs}; вне его — `undefined`. */
    public get current(): string | undefined {
        return this.id;
    }

    /**
     * Исполняет `fn` с владельцем `id` и возвращает её результат. Прежний
     * владелец восстанавливается и при исключении — вложенный вызов (одно
     * расширение синхронно зовёт API из колбэка другого) не теряет внешнего.
     */
    public runAs<T>(id: string, fn: () => T): T {
        const previous = this.id;
        this.id = id;
        try {
            return fn();
        } finally {
            this.id = previous;
        }
    }
}

/**
 * Общее состояние, разделяемое namespace'ами subprocess-шима. Собирается
 * ассемблером {@link ../VscodeNamespace.ts} и передаётся в фабрики
 * `createWindowNamespace` / `createWorkspaceNamespace` / `createLanguagesNamespace`,
 * чтобы все они работали поверх ОДНОГО реестра документов и хранилища конфигурации.
 */
export interface IVscodeHostContext {
    readonly rpc: SubprocessRpc;
    readonly registry: DocumentRegistry;
    /** Единственная точка входа текста в {@link registry} (см. DocumentSyncTracker). */
    readonly documentSync: DocumentSyncTracker;
    readonly configStore: WorkspaceConfigStore;
    /** Локальный диск субпроцесса: `workspace.fs`, `findFiles`, `openTextDocument`. */
    readonly disk: IExtHostDisk;
    /**
     * Владелец текущего создающего вызова (см. {@link ExtensionOwner}): общие
     * фабрики читают его в момент создания (id output-каналов и пунктов
     * статус-бара), его запоминают регистрации провайдеров и команд (id
     * расширения в строках сбоев stderr) и коллекции диагностик (ключ MarkerService).
     */
    readonly owner: ExtensionOwner;
}
