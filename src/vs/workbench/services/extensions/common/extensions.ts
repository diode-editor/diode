import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";

/** Counterpart of vscode `IExtensionService`. The set is static for the window's lifetime, no change events. */
export interface IExtensionService {
    /** User extensions first, then builtin ones. */
    readonly extensions: readonly IExtension[];
    getExtension(id: string): IExtension | undefined;
    whenInstalledExtensionsRegistered(): Promise<void>;
    /**
     * Before the barrier the event is remembered and replayed after registration; the promise resolves at the
     * barrier.
     */
    activateByEvent(event: string): Promise<void>;
    /**
     * Restarts the process (like upstream window reload), then runs `workspaceContains:` on the new folders.
     * Before the barrier there is no process yet, and startup itself scans the folders.
     */
    restartForWorkspaceChange(): Promise<void>;
    /** Once, in the `restored` phase. */
    start(): Promise<void>;
}

export const ExtensionServiceDIToken = token<IExtensionService>("ExtensionService");
