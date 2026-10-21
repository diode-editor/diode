import type { ILogger } from "../../log/common/iLogger.ts";

import type { IExtension } from "./iExtension.ts";

/**
 * On an id clash builtin wins, and within a list the first entry wins; each conflict logs a warning:
 * the user must know their extension is shadowed.
 */
export function mergeExtensions(
    builtin: readonly IExtension[],
    user: readonly IExtension[],
    logger?: ILogger,
): IExtension[] {
    const byId = new Map<string, IExtension>();
    const seenInList = new Set<string>();

    for (const ext of builtin) {
        if (seenInList.has(ext.id)) {
            logger?.warn(`Duplicate builtin extension id "${ext.id}" — keeping the first occurrence`);
            continue;
        }
        seenInList.add(ext.id);
        byId.set(ext.id, ext);
    }

    seenInList.clear();
    for (const ext of user) {
        if (seenInList.has(ext.id)) {
            logger?.warn(`Duplicate user extension id "${ext.id}" — keeping the first occurrence`);
            continue;
        }
        seenInList.add(ext.id);
        if (byId.has(ext.id)) {
            logger?.warn(
                `User extension "${ext.id}" is shadowed by a builtin with the same id; ignoring the user copy`,
            );
            continue;
        }
        byId.set(ext.id, ext);
    }

    return [...byId.values()];
}
