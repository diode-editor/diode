import type { ILogger } from "../../../../platform/log/common/iLogger.ts";

/** Что нужно для снятия расширения: его `deactivate` и подписки контекста. */
export interface IDeactivatableExtension {
    readonly id: string;
    readonly mod: { readonly deactivate?: () => unknown };
    readonly context: { readonly subscriptions: { dispose: () => unknown }[] };
}

/**
 * Снимает активное расширение в субпроцессе: его `deactivate()`, затем
 * `context.subscriptions` в обратном порядке (как `ExtHostExtensionService`
 * эталона). Сбой ни одного шага не прерывает остальные и наружу не бросается —
 * но и не глотается молча: строкой warn с id расширения, иначе в логе не
 * понять, ЧЬЯ уборка упала.
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
