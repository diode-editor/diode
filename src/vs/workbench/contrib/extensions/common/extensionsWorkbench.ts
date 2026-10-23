import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import type {
    IRegistryExtensionMeta,
    IRegistrySupport,
    IRegistryVersion,
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
 * Against the target version (the highest compatible one in the registry): `outdated` — the installed version is
 * lower by semver; `installed` — not lower (a newer `.vsix` is not "outdated"), or the entry was installed outside
 * the marketplace (`latestVersion` is empty); `incompatible` — the registry has no version compatible with this build.
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
    /**
     * The target version: the highest compatible one in the registry (upstream `gallery` is the compatible one too).
     * With no compatible version, the index's latest, for the reason text. `null` means no registry entry.
     */
    readonly latestVersion: string | null;
    /**
     * `publishedAt` of {@link latestVersion} (upstream `gallery.lastUpdated`), for `extensions.autoUpdateDelay`.
     * Unset when the registry has no date or no entry.
     */
    readonly latestPublishedAt?: string;
    /** Installed version; `null` means not installed. */
    readonly installedVersion: string | null;
    readonly availability: ExtensionAvailability;
    /**
     * The profile entry has `metadata.pinned`: a version the user chose, or the page's `Auto Update` unchecked (one
     * flag, decision J2). It changes neither `availability` nor the `Update to X` button, nor `Update All` (decision
     * E1), like upstream: only auto-update skips pinned ones.
     */
    readonly pinned: boolean;
    /** Installed/uninstalled in this session: contributions are scanned once at startup, takes effect after a window reload. */
    readonly needsReload: boolean;
}

/** The error is a value, not an exception: the reason goes to the UI as text, like the catalog read error. */
export type IExtensionOperationResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

export interface IExtensionInstallOptions {
    /**
     * Exactly this version (upstream `installGivenVersion`): it bypasses `engines`, not the platform, and the
     * profile entry gets pinned. Unset means the highest compatible one, and the entry keeps its pin.
     */
    readonly version?: string;
}

export type IExtensionInstallResult =
    | { readonly ok: true; readonly version: string }
    | { readonly ok: false; readonly error: string };

/** One entry per outdated extension, in list order. */
export interface IExtensionUpdateAllResult {
    readonly updated: readonly { readonly id: string; readonly version: string }[];
    readonly failed: readonly { readonly id: string; readonly error: string }[];
}

export interface IExtensionCheckOptions {
    /**
     * The scheduled check (stage 3): a failure goes to the log, not to {@link IExtensionsWorkbenchService.getCatalogError},
     * so no `Retry —` row appears under a list the user already has; the first viewlet show then reads the catalog
     * itself if there is none.
     */
    readonly background?: boolean;
}

/** Network failures are not thrown: the catalog is empty and the reason is in {@link getCatalogError}. */
export interface IExtensionsWorkbenchService {
    /**
     * Called on the first viewlet show, so no network access at startup; repeated calls do nothing. A catalog read
     * by the background check is reused.
     */
    ensureLoaded(): Promise<void>;

    refresh(): Promise<void>;

    /** Upstream `checkForUpdates`: {@link refresh} plus a re-read of the metadata, so target versions are fresh. */
    checkForUpdates(options?: IExtensionCheckOptions): Promise<void>;

    /**
     * After every catalog read — first show, Refresh, Check, background — once the entries are rebuilt; `ok` is
     * whether it succeeded. Auto-update follows a successful one (upstream `syncInstalledExtensionsWithGallery`).
     */
    onDidReadCatalog(listener: (ok: boolean) => void): IDisposable;

    /** Entries: registry entries first, then installed extensions outside the registry. */
    getEntries(): readonly IExtensionListEntry[];

    getCatalogError(): string | null;

    /** Upstream `outdated`: profile entries the registry knows with `availability` `outdated`, pinned ones too. */
    getOutdated(): readonly IExtensionListEntry[];

    /**
     * Upstream `updateAll`: every {@link getOutdated} entry by a plain install (pins stay), one after another; one
     * failure does not stop the rest.
     */
    updateAll(): Promise<IExtensionUpdateAllResult>;

    /**
     * {@link updateAll} over the given ids (auto-update's candidates). Before each install the profile is read
     * again: an entry already at its target or no longer in the profile (another window, the CLI) is skipped and is
     * not in the result (US-3.12).
     */
    updateExtensions(ids: readonly string[]): Promise<IExtensionUpdateAllResult>;

    /**
     * Upstream `updateMetadata(local, { pinned })`: only the profile entry's pin; no reload needed. The page's
     * `Auto Update` toggle: unchecked is pinned.
     */
    setPinned(id: string, pinned: boolean): Promise<IExtensionOperationResult>;

    /** Full metadata for the extension page; `undefined` means the registry doesn't know the id. */
    getMeta(id: string): Promise<IRegistryExtensionMeta | undefined>;

    /**
     * Also "update": the profile switches to the new version; a previous one no profile uses is removed on the
     * next start, so the running extension host keeps its files.
     */
    install(id: string, options?: IExtensionInstallOptions): Promise<IExtensionInstallResult>;

    /**
     * For the version picker (upstream `getAllCompatibleVersions`): newest first, compatible with this build.
     * Empty when the registry doesn't know the id; a network failure is thrown, like {@link getMeta}.
     */
    getCompatibleVersions(id: string): Promise<readonly IRegistryVersion[]>;

    /** From this profile; the files go on the next start, when no profile needs the extension. */
    uninstall(id: string): Promise<IExtensionOperationResult>;

    onDidChange(listener: () => void): IDisposable;
}

export const ExtensionsWorkbenchServiceDIToken = token<IExtensionsWorkbenchService>("ExtensionsWorkbenchService");

/** Upstream `/@outdated/i`: anywhere in the query, any case. */
const OUTDATED_FILTER = /@outdated/giu;

export interface IExtensionQuery {
    /** `@outdated`: only outdated entries. */
    readonly outdated: boolean;
    /** The rest of the query, normalized for {@link matchesExtensionQuery}. */
    readonly text: string;
}

export function parseExtensionQuery(query: string): IExtensionQuery {
    const text = query.replace(OUTDATED_FILTER, "");
    return { outdated: text !== query, text: normalizeExtensionQuery(text) };
}

/** `searchRegistryIndex` semantics (shared predicate in `registryFormat.ts`) plus the `@outdated` filter. */
export function filterExtensionEntries(entries: readonly IExtensionListEntry[], query: string): IExtensionListEntry[] {
    const { outdated, text } = parseExtensionQuery(query);
    return entries.filter(
        (entry) => (!outdated || entry.availability === "outdated") && matchesExtensionQuery(entry, text),
    );
}
