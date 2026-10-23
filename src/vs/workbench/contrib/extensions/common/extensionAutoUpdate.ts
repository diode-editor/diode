import type { IExtensionListEntry } from "./extensionsWorkbench.ts";

/** Upstream `AutoCheckUpdatesConfigurationKey`, `AutoUpdateConfigurationKey`, `AutoUpdateDelayConfigurationKey`. */
export const AUTO_CHECK_UPDATES_SETTING = "extensions.autoCheckUpdates";
export const AUTO_UPDATE_SETTING = "extensions.autoUpdate";
export const AUTO_UPDATE_DELAY_SETTING = "extensions.autoUpdateDelay";

export type AutoUpdateValue = "on" | "off";

/** Upstream `getAutoUpdateValue`: older values (`true`/`false`, `onlySelectedExtensions`) still read. */
export function toAutoUpdateValue(raw: unknown): AutoUpdateValue {
    return raw === "off" || raw === false || raw === "onlySelectedExtensions" ? "off" : "on";
}

const HOUR_MS = 60 * 60 * 1000;

export interface IAutoUpdatePlan {
    /** Install now, in list order. */
    readonly ready: readonly IExtensionListEntry[];
    /** Milliseconds until the soonest delayed one may go (upstream `delayedAutoUpdateCheckTimer`). */
    readonly retryIn: number | undefined;
}

/**
 * Upstream `autoUpdateExtensions`: the outdated entries minus pinned ones (`shouldAutoUpdateExtension`) and minus
 * versions published less than `delayHours` ago (`getAutoUpdateDelayRemaining`).
 */
export function planAutoUpdate(
    outdated: readonly IExtensionListEntry[],
    delayHours: number,
    now: number,
): IAutoUpdatePlan {
    const ready: IExtensionListEntry[] = [];
    let retryIn: number | undefined;
    for (const entry of outdated) {
        if (entry.pinned) continue;
        const remaining = delayRemaining(entry.latestPublishedAt, delayHours * HOUR_MS, now);
        if (remaining > 0) {
            retryIn = Math.min(retryIn ?? remaining, remaining);
            continue;
        }
        ready.push(entry);
    }
    return { ready, retryIn };
}

/** No date, an unreadable one or one in the future (clock skew): no delay, like upstream. */
function delayRemaining(publishedAt: string | undefined, delay: number, now: number): number {
    // Stryker disable next-line StringLiteral: any non-date string parses to NaN, the same as no date
    const published = Date.parse(publishedAt ?? "");
    // Stryker disable next-line ConditionalExpression: equivalent — a NaN delay is not `> 0` either, but the check says so
    if (Number.isNaN(published)) return 0;
    const elapsed = now - published;
    if (elapsed < 0) return 0;
    return Math.max(0, delay - elapsed);
}
