import { Emitter } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import { loadSemver, type Semver } from "../../../../base/common/semver.ts";
import type { IExtensionRegistrySource } from "../../../../platform/extensionManagement/common/iExtensionRegistrySource.ts";
import type {
    IRegistryExtensionMeta,
    IRegistryIndex,
    IRegistryIndexEntry,
    IRegistryVersion,
} from "../../../../platform/extensionManagement/common/registryFormat.ts";
import type { IHostVersions } from "../../../../platform/extensionManagement/common/resolveCompatibleVersion.ts";
import {
    areEnginesCompatible,
    compatibleVersions,
    resolveCompatibleVersion,
} from "../../../../platform/extensionManagement/common/resolveCompatibleVersion.ts";
import { installFromRegistry } from "../../../../platform/extensionManagement/node/installFromRegistry.ts";
import type {
    IProfileExtension,
    ProfileExtensions,
} from "../../../../platform/extensionManagement/node/profileExtensions.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type {
    ExtensionAvailability,
    IExtensionInstallOptions,
    IExtensionInstallResult,
    IExtensionListEntry,
    IExtensionOperationResult,
    IExtensionsWorkbenchService,
    IExtensionUpdateAllResult,
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
    /** Being installed (upstream: not `state === Installed`): not outdated, so a second Update All skips them. */
    private readonly installing = new Set<string>();

    /** semver is a lazy chunk: loaded together with the index, not at startup. */
    private catalog: { readonly index: IRegistryIndex; readonly semver: Semver } | null = null;
    private installed: readonly IProfileExtension[];
    private catalogError: string | null = null;
    private entries: readonly IExtensionListEntry[];
    /** A promise, not a flag: concurrent shows wait for one fetch. */
    private loading: Promise<void> | null = null;

    public constructor(
        private readonly source: IExtensionRegistrySource,
        private readonly profile: ProfileExtensions,
        private readonly host: IHostVersions,
        private readonly logger: Pick<ILogger, "warn">,
    ) {
        super();
        this.installed = profile.list();
        this.entries = this.computeEntries();
    }

    public ensureLoaded(): Promise<void> {
        this.loading ??= this.load(false);
        return this.loading;
    }

    public refresh(): Promise<void> {
        this.loading = this.load(false);
        return this.loading;
    }

    public getEntries(): readonly IExtensionListEntry[] {
        return this.entries;
    }

    /** Like {@link refresh}, plus fresh metadata: a new compatible version may have appeared. */
    public checkForUpdates(): Promise<void> {
        this.loading = this.load(true);
        return this.loading;
    }

    public getCatalogError(): string | null {
        return this.catalogError;
    }

    public getOutdated(): readonly IExtensionListEntry[] {
        return this.entries.filter((entry) => entry.availability === "outdated" && !this.installing.has(entry.id));
    }

    /** One after another: each install rewrites the profile file. The whole batch counts as being installed. */
    public async updateAll(): Promise<IExtensionUpdateAllResult> {
        const updated: { id: string; version: string }[] = [];
        const failed: { id: string; error: string }[] = [];
        const ids = this.getOutdated().map((entry) => entry.id);
        for (const id of ids) this.installing.add(id);
        for (const id of ids) {
            const result = await this.install(id);
            if (result.ok) updated.push({ id, version: result.version });
            else failed.push({ id, error: result.error });
        }
        return { updated, failed };
    }

    /** A miss (`undefined`) is cached, "not in the registry" is an answer too; a network failure is not, it is thrown to the caller. */
    public async getMeta(id: string): Promise<IRegistryExtensionMeta | undefined> {
        if (this.metaCache.has(id)) return this.metaCache.get(id);
        const meta = await this.source.getMeta(id);
        this.metaCache.set(id, meta);
        return meta;
    }

    /**
     * Also "update": the profile switches to the new version, the old one stays on disk for the running
     * host and is removed on the next start.
     */
    public async install(id: string, options: IExtensionInstallOptions = {}): Promise<IExtensionInstallResult> {
        this.installing.add(id);
        try {
            // Dependencies are installed without asking, as in VS Code, and also wait for a window reload.
            const installed = await installFromRegistry(this.source, id, {
                extensionsDir: this.profile.extensionsDir,
                host: this.host,
                version: options.version,
            });
            const { version, dependencies } = installed;
            // Into the profile, including dependencies already on disk for another profile. A given version is
            // pinned (upstream `installGivenVersion`); otherwise the entry keeps its pin.
            this.profile.add([installed], {
                ...(options.version !== undefined ? { pinned: true } : {}),
                dependencies,
            });
            for (const dep of dependencies) this.pendingReload.add(dep.id);
            this.markChanged(id);
            return { ok: true, version };
        } catch (error) {
            return { ok: false, error: messageOf(error) };
        } finally {
            this.installing.delete(id);
        }
    }

    public async getCompatibleVersions(id: string): Promise<readonly IRegistryVersion[]> {
        const [meta, semver] = await Promise.all([this.getMeta(id), loadSemver()]);
        return meta === undefined ? [] : compatibleVersions(meta.versions, this.host, semver);
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

    /** `freshMeta`: re-fetch the metadata, but only once the index is read — offline keeps the last targets. */
    private async load(freshMeta: boolean): Promise<void> {
        try {
            const [index, semver] = await Promise.all([this.source.getIndex(), loadSemver()]);
            await this.loadTargetMeta(index, semver, freshMeta);
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

    /**
     * The index carries only the latest version and knows neither the other versions nor platforms. The metadata
     * decides where that matters: an incompatible latest (the target may be older), and a latest above the installed
     * version (it may exist only for another platform — then it is no update). Only these entries cost a request,
     * and only once the catalog is read (no network at startup).
     */
    private async loadTargetMeta(index: IRegistryIndex, semver: Semver, fresh: boolean): Promise<void> {
        const installed = new Map(this.profile.list().map((e) => [e.id, e.version]));
        const ids = index.extensions
            .filter(
                (entry) =>
                    !areEnginesCompatible(entry.latest.engines, this.host, semver) ||
                    isNewer(entry.latest.version, installed.get(entry.id), semver),
            )
            .map((entry) => entry.id);
        await Promise.all(
            ids.map(async (id) => {
                try {
                    this.metaCache.set(id, fresh ? await this.source.getMeta(id) : await this.getMeta(id));
                } catch (error) {
                    // Not a catalog error: the rest of the catalog is fine. A fresh fetch keeps the previous answer.
                    this.logger.warn(`Could not read the metadata of ${id}: ${messageOf(error)}`);
                }
            }),
        );
        if (!fresh) return;
        // The rest (pages, the version picker) is fetched again on demand.
        const kept = new Set(ids);
        for (const id of [...this.metaCache.keys()]) if (!kept.has(id)) this.metaCache.delete(id);
    }

    /** From the metadata when it is known; otherwise the latest if its `engines` fit. `undefined`: none compatible. */
    private targetVersionOf(entry: IRegistryIndexEntry, semver: Semver): string | undefined {
        const meta = this.metaCache.get(entry.id);
        if (meta !== undefined) return resolveCompatibleVersion(meta.versions, this.host, semver)?.version;
        return areEnginesCompatible(entry.latest.engines, this.host, semver) ? entry.latest.version : undefined;
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
        installed: IProfileExtension | undefined,
        semver: Semver,
    ): IExtensionListEntry {
        const target = this.targetVersionOf(entry, semver);
        return {
            id: entry.id,
            publisher: entry.publisher,
            name: entry.name,
            displayName: entry.displayName,
            description: entry.description,
            kind: entry.kind,
            support: entry.support,
            latestVersion: target ?? entry.latest.version,
            installedVersion: installed?.version ?? null,
            availability: availabilityOf(target, installed, semver),
            pinned: installed?.pinned ?? false,
            needsReload: this.pendingReload.has(entry.id),
        };
    }

    private fireChange(): void {
        this.onDidChangeEmitter.fire();
    }
}

/**
 * Incompatibility (no compatible version at all) beats "installed": knowing there is nothing to update to matters
 * more. Outdated is by semver, like upstream `semver.gt`: a rollback or a newer `.vsix` is not an update.
 */
function availabilityOf(
    target: string | undefined,
    installed: IProfileExtension | undefined,
    semver: Semver,
): ExtensionAvailability {
    if (target === undefined) return "incompatible";
    if (installed === undefined) return "available";
    return isNewer(target, installed.version, semver) ? "outdated" : "installed";
}

/** A manifest version that is not semver can't be compared: never older, like upstream's failing `gt`. */
function isNewer(target: string, installed: string | undefined, semver: Semver): boolean {
    // Stryker disable next-line ConditionalExpression: equivalent — `semver.valid(undefined)` is null as well; the check is for the types
    return installed !== undefined && semver.valid(installed) !== null && semver.gt(target, installed);
}

/** Installed outside the marketplace: only the manifest is known, the entry is always `installed`. */
function toSideloadedEntry(installed: IProfileExtension, needsReload: boolean): IExtensionListEntry {
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
        pinned: installed.pinned,
        needsReload,
    };
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
