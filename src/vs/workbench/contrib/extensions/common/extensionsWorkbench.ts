import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import type {
    IRegistryExtensionMeta,
    IRegistrySupport,
    RegistryExtensionKind,
} from "../../../../platform/extensionManagement/common/registryFormat.ts";
import {
    matchesExtensionQuery,
    normalizeExtensionQuery,
} from "../../../../platform/extensionManagement/common/registryFormat.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";

// Contract in `common/`, implementation in `node/`: otherwise the viewlet in `browser/` would need
// a `browser → node` exception in scripts/check-layers.mjs.

/**
 * `installed`: the version matches the latest in the registry, or the entry was installed outside the
 * marketplace (`latestVersion` is empty); `incompatible`: the latest registry version fails this build's `engines`.
 */
export type ExtensionAvailability = "available" | "installed" | "outdated" | "incompatible";

export interface IExtensionListEntry {
    /** `publisher.name`. */
    readonly id: string;
    readonly publisher: string;
    readonly name: string;
    readonly displayName: string;
    readonly description: string;
    /** `undefined`: the entry is not in the registry (installed outside the marketplace). */
    readonly kind: RegistryExtensionKind | undefined;
    /** `undefined`: no registry entry, or the registry did not set the flag. */
    readonly support: IRegistrySupport | undefined;
    /** Latest version in the registry; `null` means no registry entry. */
    readonly latestVersion: string | null;
    /** Installed version; `null` means not installed. */
    readonly installedVersion: string | null;
    readonly availability: ExtensionAvailability;
    /** Installed/uninstalled in this session: contributions are scanned once at startup, takes effect after a window reload. */
    readonly needsReload: boolean;
}

/** The error is a value, not an exception: the reason goes to the UI as text, like the catalog read error. */
export type IExtensionOperationResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

export type IExtensionInstallResult =
    | { readonly ok: true; readonly version: string }
    | { readonly ok: false; readonly error: string };

/** Network failures are not thrown: the catalog is empty and the reason is in {@link getCatalogError}. */
export interface IExtensionsWorkbenchService {
    /** Called on the first viewlet show, so no network access at startup; repeated calls do nothing. */
    ensureLoaded(): Promise<void>;

    refresh(): Promise<void>;

    /** Entries: registry entries first, then installed extensions outside the registry. */
    getEntries(): readonly IExtensionListEntry[];

    getCatalogError(): string | null;

    /** Full metadata for the extension page; `undefined` means the registry doesn't know the id. */
    getMeta(id: string): Promise<IRegistryExtensionMeta | undefined>;

    /**
     * Also "update": the profile switches to the new version; a previous one no profile uses is removed on the
     * next start, so the running extension host keeps its files.
     */
    install(id: string): Promise<IExtensionInstallResult>;

    /** From this profile; the files go on the next start, when no profile needs the extension. */
    uninstall(id: string): Promise<IExtensionOperationResult>;

    onDidChange(listener: () => void): IDisposable;
}

export const ExtensionsWorkbenchServiceDIToken = token<IExtensionsWorkbenchService>("ExtensionsWorkbenchService");

/** `searchRegistryIndex` semantics (shared predicate in `registryFormat.ts`). */
export function filterExtensionEntries(entries: readonly IExtensionListEntry[], query: string): IExtensionListEntry[] {
    const needle = normalizeExtensionQuery(query);
    return entries.filter((entry) => matchesExtensionQuery(entry, needle));
}
