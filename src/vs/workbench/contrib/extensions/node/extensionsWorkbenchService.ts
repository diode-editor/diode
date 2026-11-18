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
import {
    installFromRegistry,
    installVsixWithDependencies,
} from "../../../../platform/extensionManagement/node/installFromRegistry.ts";
import type {
    IProfileExtension,
    ProfileExtensions,
} from "../../../../platform/extensionManagement/node/profileExtensions.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type {
    ExtensionAvailability,
    ExtensionOperation,
    IExtensionCheckOptions,
    IExtensionInstallOptions,
    IExtensionInstallResult,
    IExtensionListEntry,
    IExtensionOperationResult,
    IExtensionsWorkbenchService,
    IExtensionUpdateAllResult,
    IVsixInstallResult,
} from "../common/extensionsWorkbench.ts";

/**
 * The catalog is cached in memory for the session; re-reading is an explicit Refresh. There is deliberately no
 * on-disk cache with TTL: it is a separate layer with its own invalidation (docs/arch/workbench/ExtensionsView.md).
 */
export class ExtensionsWorkbenchService extends Disposable implements IExtensionsWorkbenchService {
    private readonly onDidChangeEmitter = this.register(new Emitter<void>());
    private readonly onDidReadCatalogEmitter = this.register(new Emitter<boolean>());
    private readonly onDidChangeDownloadProgressEmitter = this.register(new Emitter<string>());
    private readonly metaCache = new Map<string, IRegistryExtensionMeta | undefined>();
    /** Installed/uninstalled in this session: contributions won't apply until a window reload. */
    private readonly pendingReload = new Set<string>();
    /**
     * Upstream `ExtensionState.Installing`/`Uninstalling`. An `Update All` batch is installing from the start, so a
     * second one (or the page's Update) skips the queued ones too.
     */
    private readonly operations = new Map<string, ExtensionOperation>();
    /** The installs in flight: a second install of the same id joins the first. */
    private readonly running = new Map<string, Promise<IExtensionInstallResult>>();
    private readonly downloads = new Map<string, number>();

    /** semver is a lazy chunk: loaded together with the index, not at startup. */
    private catalog: { readonly index: IRegistryIndex; readonly semver: Semver } | null = null;
    private installed: readonly IProfileExtension[];
    private catalogError: string | null = null;
    private entries: readonly IExtensionListEntry[];
    /** A promise, not a flag: concurrent shows wait for one fetch. */
    private loading: Promise<unknown> | null = null;

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

    /** A background check that failed before any catalog leaves nothing to show: the show reads it itself. */
    public async ensureLoaded(): Promise<void> {
        do await (this.loading ??= this.load(false));
        while (!this.hasCatalogAnswer());
    }

    /** A method, not an inline check: the awaited read may reset `loading`, which narrowing would not see. */
    private hasCatalogAnswer(): boolean {
        return this.loading !== null;
    }

    public async refresh(): Promise<void> {
        this.loading = this.load(false);
        await this.loading;
    }

    public getEntries(): readonly IExtensionListEntry[] {
        return this.entries;
    }

    /** Like {@link refresh}, plus fresh metadata: a new compatible version may have appeared. */
    public checkForUpdates(options: IExtensionCheckOptions = {}): Promise<void> {
        const background = options.background === true;
        const loading: Promise<void> = this.load(true, background).then(() => {
            // Nothing read and no error to show: the first viewlet show must not settle for an empty list. A read
            // started after this one is its own answer.
            if (background && this.catalog === null && this.loading === loading) this.loading = null;
        });
        this.loading = loading;
        return loading;
    }

    public readonly onDidReadCatalog = this.onDidReadCatalogEmitter.event;

    public getCatalogError(): string | null {
        return this.catalogError;
    }

    public getOutdated(): readonly IExtensionListEntry[] {
        return this.entries.filter((entry) => entry.availability === "outdated" && entry.operation === null);
    }

    public updateAll(): Promise<IExtensionUpdateAllResult> {
        return this.updateExtensions(this.getOutdated().map((entry) => entry.id));
    }

    /** One after another: each install rewrites the profile file. The whole batch counts as being installed. */
    public async updateExtensions(ids: readonly string[]): Promise<IExtensionUpdateAllResult> {
        const updated: { id: string; version: string }[] = [];
        const failed: { id: string; error: string }[] = [];
        const wanted = new Set(ids);
        const targets = this.getOutdated().filter((entry) => wanted.has(entry.id));
        for (const { id } of targets) this.operations.set(id, "installing");
        if (targets.length > 0) this.rebuildEntries();
        for (const { id, latestVersion } of targets) {
            if (this.isHandledElsewhere(id, String(latestVersion))) {
                // Another window or the CLI got there first (US-3.12) — updated or uninstalled it; this window still
                // runs the old version.
                this.pendingReload.add(id);
                this.endOperation(id);
                continue;
            }
            const result = await this.install(id);
            if (result.ok) updated.push({ id, version: result.version });
            else failed.push({ id, error: result.error });
        }
        return { updated, failed };
    }

    /** The profile on disk, not the session's copy: other processes write it too. */
    private isHandledElsewhere(id: string, target: string): boolean {
        const key = id.toLowerCase();
        const current = this.profile.list().find((e) => e.id.toLowerCase() === key);
        if (current === undefined) return true;
        // Stryker disable next-line OptionalChaining: an outdated entry exists only once the catalog (and semver) is read
        const semver = this.catalog?.semver;
        // Stryker disable next-line ConditionalExpression: the same — the check is for the types
        return semver !== undefined && !isNewer(target, current.version, semver);
    }

    public setPinned(id: string, pinned: boolean): Promise<IExtensionOperationResult> {
        try {
            if (!this.profile.setPinned(id, pinned)) {
                return Promise.resolve({ ok: false, error: `Extension ${id} is not installed` });
            }
            // Not `markChanged`: the pin is not a contribution, the running host is still right.
            this.reloadInstalled();
            return Promise.resolve({ ok: true });
        } catch (error) {
            return Promise.resolve({ ok: false, error: messageOf(error) });
        }
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
    public install(id: string, options: IExtensionInstallOptions = {}): Promise<IExtensionInstallResult> {
        const running = this.running.get(id);
        if (running !== undefined) return running;
        const install = this.runInstall(id, options).finally(() => {
            this.running.delete(id);
        });
        this.running.set(id, install);
        return install;
    }

    private async runInstall(id: string, options: IExtensionInstallOptions): Promise<IExtensionInstallResult> {
        this.startOperation(id, "installing");
        try {
            // Dependencies are installed without asking, as in VS Code, and also wait for a window reload.
            const installed = await installFromRegistry(this.source, id, {
                extensionsDir: this.profile.extensionsDir,
                host: this.host,
                version: options.version,
                onDownloadProgress: (percent) => {
                    this.setDownloadProgress(id, percent);
                },
            });
            const { version, dependencies } = installed;
            // Into the profile, including dependencies already on disk for another profile. A given version is
            // pinned (upstream `installGivenVersion`); otherwise the entry keeps its pin.
            this.profile.add([installed], {
                ...(options.version !== undefined ? { pinned: true } : {}),
                dependencies,
            });
            for (const dep of dependencies) this.pendingReload.add(dep.id);
            this.pendingReload.add(id);
            return { ok: true, version };
        } catch (error) {
            return { ok: false, error: messageOf(error) };
        } finally {
            this.setDownloadProgress(id, null);
            this.endOperation(id);
        }
    }

    public getDownloadProgress(id: string): number | null {
        return this.downloads.get(id) ?? null;
    }

    public readonly onDidChangeDownloadProgress = this.onDidChangeDownloadProgressEmitter.event;

    /** `installFromRegistry` reports only changes; the end of an install that measured nothing is not one either. */
    private setDownloadProgress(id: string, percent: number | null): void {
        if (this.getDownloadProgress(id) === percent) return;
        if (percent === null) this.downloads.delete(id);
        else this.downloads.set(id, percent);
        this.onDidChangeDownloadProgressEmitter.fire(id);
    }

    /** Fires right away: the page and the list switch before any progress delay. */
    private startOperation(id: string, operation: ExtensionOperation): void {
        this.operations.set(id, operation);
        this.rebuildEntries();
    }

    /** One change for the end and its result: the profile is re-read, the reload mark is already set on success. */
    private endOperation(id: string): void {
        this.operations.delete(id);
        this.reloadInstalled();
    }

    /**
     * Our directory is `<id>-<version>` with no platform suffix (upstream adds it), so a platform package of the
     * running version lands where the running extension looks: CodeLLDB finds `adapter/` with no reload, while
     * upstream installs next to it and asks for one.
     */
    public async installVsix(vsixPath: string): Promise<IVsixInstallResult> {
        const before = this.profile.list();
        const installed = await installVsixWithDependencies(() => this.source, vsixPath, {
            extensionsDir: this.profile.extensionsDir,
            host: this.host,
        });
        const { id, dir, dependencies, dependencyError } = installed;
        if (dependencyError !== undefined) {
            this.logger.warn(`Could not install the dependencies of ${id}: ${dependencyError}`);
        }
        this.profile.add([installed], { pinned: true, dependencies });
        for (const dep of dependencies) this.pendingReload.add(dep.id);
        // The host runs what the profile pointed to at startup, unless this session has changed it since. The
        // directory names the id and the version.
        const running = !this.pendingReload.has(id) && before.some((e) => e.dir === dir);
        if (running) this.reloadInstalled();
        else this.markChanged(id);
        return { needsReload: !running || dependencies.length > 0 };
    }

    public async getCompatibleVersions(id: string): Promise<readonly IRegistryVersion[]> {
        const [meta, semver] = await Promise.all([this.getMeta(id), loadSemver()]);
        return meta === undefined ? [] : compatibleVersions(meta.versions, this.host, semver);
    }

    public uninstall(id: string): Promise<IExtensionOperationResult> {
        this.startOperation(id, "uninstalling");
        try {
            const { removed } = this.profile.remove(id);
            if (!removed) {
                // Nothing to remove is not a success: the entry would keep an
                // Uninstall button that does nothing.
                return Promise.resolve({ ok: false, error: `Extension ${id} is not installed` });
            }
            this.pendingReload.add(id);
            return Promise.resolve({ ok: true });
        } catch (error) {
            return Promise.resolve({ ok: false, error: messageOf(error) });
        } finally {
            this.endOperation(id);
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

    /**
     * `freshMeta`: re-fetch the metadata, but only once the index is read — offline keeps the last targets.
     * `background`: a failure is only logged. `true` means the catalog was read.
     */
    private async load(freshMeta: boolean, background = false): Promise<boolean> {
        let ok = true;
        try {
            const [index, semver] = await Promise.all([this.source.getIndex(), loadSemver()]);
            await this.loadTargetMeta(index, semver, freshMeta);
            this.catalog = { index, semver };
            this.catalogError = null;
        } catch (error) {
            ok = false;
            // Keep the last successful index: a stale list is better
            // than an empty one, and the reason is shown on a separate row.
            if (background) this.logger.warn(`Could not check for extension updates: ${messageOf(error)}`);
            else this.catalogError = messageOf(error);
        }
        this.installed = this.profile.list();
        this.rebuildEntries();
        this.onDidReadCatalogEmitter.fire(ok);
        return ok;
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
                    // Fresh on every read: a cached answer (a page, the picker) may predate the release.
                    this.metaCache.set(id, await this.source.getMeta(id));
                } catch (error) {
                    // Not a catalog error: the rest of the catalog is fine; the previous answer stays.
                    this.logger.warn(`Could not read the metadata of ${id}: ${messageOf(error)}`);
                }
            }),
        );
        if (!fresh) return;
        // The rest (pages, the version picker) is fetched again on demand.
        const kept = new Set(ids);
        for (const id of [...this.metaCache.keys()]) if (!kept.has(id)) this.metaCache.delete(id);
    }

    /**
     * From the metadata when it is known and not older than the index; otherwise the latest if its `engines` fit
     * (the index carries no date). `undefined`: none compatible.
     */
    private targetVersionOf(
        entry: IRegistryIndexEntry,
        semver: Semver,
    ): { readonly version: string; readonly publishedAt?: string | null } | undefined {
        const latestFits = areEnginesCompatible(entry.latest.engines, this.host, semver);
        const meta = this.metaCache.get(entry.id);
        const current = meta?.versions.some((v) => v.version === entry.latest.version) === true;
        if (meta !== undefined && (current || !latestFits)) {
            const version = resolveCompatibleVersion(meta.versions, this.host, semver);
            return version && { version: version.version, publishedAt: version.publishedAt ?? null };
        }
        return latestFits ? { version: entry.latest.version } : undefined;
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
            entries.push({
                ...toSideloadedEntry(installed),
                needsReload: this.pendingReload.has(installed.id),
                operation: this.operations.get(installed.id) ?? null,
            });
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
            categories: entry.categories ?? installed?.categories ?? [],
            tags: entry.tags ?? installed?.keywords ?? [],
            latestVersion: target?.version ?? entry.latest.version,
            latestPublishedAt: target?.publishedAt,
            installedVersion: installed?.version ?? null,
            availability: availabilityOf(target?.version, installed, semver),
            pinned: installed?.pinned ?? false,
            needsReload: this.pendingReload.has(entry.id),
            operation: this.operations.get(entry.id) ?? null,
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
function toSideloadedEntry(installed: IProfileExtension): Omit<IExtensionListEntry, "needsReload" | "operation"> {
    const dot = installed.id.indexOf(".");
    return {
        id: installed.id,
        publisher: installed.id.slice(0, dot),
        name: installed.id.slice(dot + 1),
        displayName: installed.displayName ?? installed.id,
        description: installed.description ?? "",
        kind: undefined,
        support: undefined,
        categories: installed.categories,
        tags: installed.keywords,
        latestVersion: null,
        installedVersion: installed.version,
        availability: "installed",
        pinned: installed.pinned,
    };
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
