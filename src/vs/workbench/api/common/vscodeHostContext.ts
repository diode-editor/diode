import type { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import type { RpcEndpoint } from "./rpcEndpoint.ts";
import type { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

/**
 * Общее состояние, разделяемое namespace'ами subprocess-шима. Собирается
 * ассемблером {@link ../VscodeNamespace.ts} и передаётся в фабрики
 * `createWindowNamespace` / `createWorkspaceNamespace` / `createLanguagesNamespace`,
 * чтобы все они работали поверх ОДНОГО реестра документов и хранилища конфигурации.
 */
export interface IVscodeHostContext {
    readonly rpc: RpcEndpoint;
    readonly registry: DocumentRegistry;
    /** Единственная точка входа текста в {@link registry} (см. DocumentSyncTracker). */
    readonly documentSync: DocumentSyncTracker;
    readonly configStore: WorkspaceConfigStore;
}
