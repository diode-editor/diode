import type { ILogger } from "../../../../platform/log/common/iLogger.ts";

export interface IDeactivatableExtension {
    readonly id: string;
    readonly mod: { readonly deactivate?: () => unknown };
    readonly context: { readonly subscriptions: { dispose: () => unknown }[] };
}

/**
 * `deactivate()`, затем `context.subscriptions` в обратном порядке (как
 * `ExtHostExtensionService` эталона). Сбой шага не прерывает остальные, но пишется
 * warn с id расширения — иначе в логе не понять, ЧЬЯ уборка упала.
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
