import type { ILogger } from "../../../../platform/log/common/iLogger.ts";

export interface IDeactivatableExtension {
    readonly id: string;
    readonly mod: { readonly deactivate?: () => unknown };
    readonly context: { readonly subscriptions: { dispose: () => unknown }[] };
}

/**
 * `deactivate()`, then `context.subscriptions` in reverse order (like upstream
 * `ExtHostExtensionService`). A failed step doesn't stop the rest, but is logged as a
 * warn with the extension id, otherwise the log can't tell WHOSE cleanup failed.
 */
export async function deactivateExtension(active: IDeactivatableExtension, logger: ILogger): Promise<void> {
    try {
        await active.mod.deactivate?.();
    } catch (err) {
        logger.warn(`[${active.id}] deactivate failed`, err);
    }
    for (const sub of active.context.subscriptions.splice(0).reverse()) {
        try {
            sub.dispose();
        } catch (err) {
            logger.warn(`[${active.id}] subscription dispose failed`, err);
        }
    }
}
