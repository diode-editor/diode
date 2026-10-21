import { Emitter } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import { loadSemver, type Semver } from "../../../../base/common/semver.ts";
import type { IExtensionRegistrySource } from "../../../../platform/extensionManagement/common/iExtensionRegistrySource.ts";
import type {
    IRegistryExtensionMeta,
    IRegistryIndex,
    IRegistryIndexEntry,
} from "../../../../platform/extensionManagement/common/registryFormat.ts";
import type { IHostVersions } from "../../../../platform/extensionManagement/common/resolveCompatibleVersion.ts";
import { areEnginesCompatible } from "../../../../platform/extensionManagement/common/resolveCompatibleVersion.ts";
import type { IInstalledExtension } from "../../../../platform/extensionManagement/node/extensionInstaller.ts";
import { installFromRegistry } from "../../../../platform/extensionManagement/node/installFromRegistry.ts";
import type { ProfileExtensions } from "../../../../platform/extensionManagement/node/profileExtensions.ts";
import type {
    ExtensionAvailability,
    IExtensionInstallResult,
    IExtensionListEntry,
    IExtensionOperationResult,
    IExtensionsWorkbenchService,
} from "../common/extensionsWorkbench.ts";

/**
 * The catalog is cached in memory for the session; re-reading is an explicit Refresh. There is deliberately no
 * on-disk cache with TTL: it is a separate layer with its own invalidation (docs/arch/workbench/ExtensionsView.md).
 */
export class ExtensionsWorkbenchService extends Disposable implements IExtensionsWorkbenchService {
    private readonly onDidChangeEmitter = this.register(new Emitter<void>());
    private readonly metaCache = new Map<string, IRegistryExtensionMeta | undefined>();
    /** Installed/uninstalled in this session: contributions won't apply until a window reload. */
    private readonly pendingReload = new Set<string>();

    /** semver is a lazy chunk: loaded together with the index, not at startup. */
    private catalog: { readonly index: IRegistryIndex; readonly semver: Semver } | null = null;
    private installed: readonly IInstalledExtension[];
    private catalogError: string | null = null;
    private entries: readonly IExtensionListEntry[];
    /** A promise, not a flag: concurrent shows wait for one fetch. */
    private loading: Promise<void> | null = null;

    public constructor(
        private readonly source: IExtensionRegistrySource,
        private readonly profile: ProfileExtensions,
        private readonly host: IHostVersions,
    ) {
        super();
        this.installed = profile.list();
        this.entries = this.computeEntries();
    }

    public ensureLoaded(): Promise<void> {
        this.loading ??= this.load();
        return this.loading;
    }

    public refresh(): Promise<void> {
        this.loading = this.load();
        return this.loading;
    }

    public getEntries(): readonly IExtensionListEntry[] {
        return this.entries;
    }

    public getCatalogError(): string | null {
        return this.catalogError;
    }

    /** A miss (`undefined`) is cached, "not in the registry" is an answer too; a network failure is not, it is thrown to the caller. */
    public async getMeta(id: string): Promise<IRegistryExtensionMeta | undefined> {
        if (this.metaCache.has(id)) return this.metaCache.get(id);
        const meta = await this.source.getMeta(id);
        this.metaCache.set(id, meta);
        return meta;
    }

    /** Also "update": `installVsix` removes other versions of the same id. */
    public async install(id: string): Promise<IExtensionInstallResult> {
        try {
            // Dependencies are installed without asking, as in VS Code, and also wait for a window reload.
            const { version, dependencies } = await installFromRegistry(this.source, id, {
                extensionsDir: this.profile.extensionsDir,
                host: this.host,
            });
            // Into the profile, including dependencies already on disk for another profile.
            this.profile.add([id]);
            for (const dep of dependencies) this.pendingReload.add(dep.id);
            this.markChanged(id);
            return { ok: true, version };
        } catch (error) {
            return { ok: false, error: messageOf(error) };
        }
    }

    public uninstall(id: string): Promise<IExtensionOperationResult> {
        try {
            const { removed } = this.profile.remove(id);
            if (!removed) {
                // Nothing to remove is not a success: the entry would keep an
                // Uninstall button that does nothing.
                return Promise.resolve({ ok: false, error: `Extension ${id} is not installed` });
            }
            this.markChanged(id);
            return Promise.resolve({ ok: true });
        } catch (error) {
            return Promise.resolve({ ok: false, error: messageOf(error) });
        }
    }

    /** Contributions are scanned once at startup, so changes wait for a window reload. */
    private markChanged(id: string): void {
        this.pendingReload.add(id);
        this.reloadInstalled();
    }

    public readonly onDidChange = this.onDidChangeEmitter.event;

    public reloadInstalled(): void {
        this.installed = this.profile.list();
        this.rebuildEntries();
    }

    private async load(): Promise<void> {
        try {
            const [index, semver] = await Promise.all([this.source.getIndex(), loadSemver()]);
            this.catalog = { index, semver };
            this.catalogError = null;
        } catch (error) {
            // Keep the last successful index: a stale list is better
            // than an empty one, and the reason is shown on a separate row.
            this.catalogError = messageOf(error);
        }
        this.installed = this.profile.list();
        this.rebuildEntries();
    }

    private rebuildEntries(): void {
        this.entries = this.computeEntries();
        this.fireChange();
    }

    /** A registry entry and its installed copy are one entry: otherwise a marketplace install would show again as sideloaded. */
    private computeEntries(): readonly IExtensionListEntry[] {
        const installedById = new Map(this.installed.map((e) => [e.id, e]));
        const entries: IExtensionListEntry[] = [];
        if (this.catalog !== null) {
            const { index, semver } = this.catalog;
            for (const entry of index.extensions) {
                entries.push(this.toCatalogEntry(entry, installedById.get(entry.id), semver));
                installedById.delete(entry.id);
            }
        }
        for (const installed of installedById.values()) {
            entries.push(toSideloadedEntry(installed, this.pendingReload.has(installed.id)));
        }
        return entries;
    }

    private toCatalogEntry(
        entry: IRegistryIndexEntry,
        installed: IInstalledExtension | undefined,
        semver: Semver,
    ): IExtensionListEntry {
        return {
            id: entry.id,
            publisher: entry.publisher,
            name: entry.name,
            displayName: entry.displayName,
            description: entry.description,
            kind: entry.kind,
            support: entry.support,
            latestVersion: entry.latest.version,
            installedVersion: installed?.version ?? null,
            availability: availabilityOf(entry, installed, this.host, semver),
            needsReload: this.pendingReload.has(entry.id),
        };
    }

    private fireChange(): void {
        this.onDidChangeEmitter.fire();
    }
}

/**
 * Incompatibility is by `latest.engines` (the index has no other versions) and beats "installed":
 * knowing there is nothing to update to matters more.
 */
function availabilityOf(
    entry: IRegistryIndexEntry,
    installed: IInstalledExtension | undefined,
    host: IHostVersions,
    semver: Semver,
): ExtensionAvailability {
    if (!areEnginesCompatible(entry.latest.engines, host, semver)) return "incompatible";
    if (installed === undefined) return "available";
    return installed.version === entry.latest.version ? "installed" : "outdated";
}

/** Installed outside the marketplace: only the manifest is known, the entry is always `installed`. */
function toSideloadedEntry(installed: IInstalledExtension, needsReload: boolean): IExtensionListEntry {
    const dot = installed.id.indexOf(".");
    return {
        id: installed.id,
        publisher: installed.id.slice(0, dot),
        name: installed.id.slice(dot + 1),
        displayName: installed.displayName ?? installed.id,
        description: installed.description ?? "",
        kind: undefined,
        support: undefined,
        latestVersion: null,
        installedVersion: installed.version,
        availability: "installed",
        needsReload,
    };
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
