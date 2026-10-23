import { fromNow } from "../../../../base/common/date.ts";
import type { IRegistryVersion } from "../../../../platform/extensionManagement/common/registryFormat.ts";
import type { QuickPickItem } from "../../../common/quickPickItem.ts";

/**
 * Rows of upstream `InstallAnotherVersionAction`: the version, its age (`fromNow(date, true)`) and ` (current)`
 * for the installed one. The registry's `publishedAt` is optional, so a row may have no date.
 */
export function describeVersionPicks(
    versions: readonly IRegistryVersion[],
    installedVersion: string | null,
    now: number,
): QuickPickItem[] {
    return versions.map((v) => {
        const published = Date.parse(v.publishedAt ?? "");
        const parts = [
            Number.isNaN(published) ? undefined : fromNow(published, now, true),
            v.version === installedVersion ? "(current)" : undefined,
        ].filter((part) => part !== undefined);
        return { label: v.version, ...(parts.length > 0 ? { description: parts.join(" ") } : {}) };
    });
}
