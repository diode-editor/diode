import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";

/** Аналог `IExtensionService` vscode. Набор статичен на время жизни окна — событий изменения состава нет. */
export interface IExtensionService {
    /** Пользовательские, затем встроенные. */
    readonly extensions: readonly IExtension[];
    getExtension(id: string): IExtension | undefined;
    whenInstalledExtensionsRegistered(): Promise<void>;
    /** До барьера событие запоминается и проигрывается после регистрации; промис резолвится на барьере. */
    activateByEvent(event: string): Promise<void>;
    /**
     * Перезапуск процесса (как reload окна у эталона), затем `workspaceContains:` по новым папкам.
     * До барьера процесса ещё нет, а проход по папкам сделает сам старт.
     */
    restartForWorkspaceChange(): Promise<void>;
    /** Один раз, в фазе `restored`. */
    start(): Promise<void>;
}

export const ExtensionServiceDIToken = token<IExtensionService>("ExtensionService");
