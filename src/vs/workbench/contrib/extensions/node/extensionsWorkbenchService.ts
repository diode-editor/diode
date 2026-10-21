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
 * Каталог кэшируется в памяти на сессию, перечитывание — явный Refresh. Дискового кэша с TTL нет
 * сознательно: это отдельный слой со своей инвалидацией (docs/arch/workbench/ExtensionsView.md).
 */
export class ExtensionsWorkbenchService extends Disposable implements IExtensionsWorkbenchService {
    private readonly onDidChangeEmitter = this.register(new Emitter<void>());
    private readonly metaCache = new Map<string, IRegistryExtensionMeta | undefined>();
    /** Что ставили/удаляли в этой сессии: до перезагрузки окна вклады не поедут. */
    private readonly pendingReload = new Set<string>();

    /** semver — ленивый кусок бандла: грузится вместе с индексом, а не на старте. */
    private catalog: { readonly index: IRegistryIndex; readonly semver: Semver } | null = null;
    private installed: readonly IInstalledExtension[];
    private catalogError: string | null = null;
    private entries: readonly IExtensionListEntry[];
    /** Промис, а не флаг: параллельные показы ждут один фетч. */
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

    /** Промах (`undefined`) кэшируется — «нет в реестре» тоже ответ; сетевой сбой — нет, он бросается вызывающему. */
    public async getMeta(id: string): Promise<IRegistryExtensionMeta | undefined> {
        if (this.metaCache.has(id)) return this.metaCache.get(id);
        const meta = await this.source.getMeta(id);
        this.metaCache.set(id, meta);
        return meta;
    }

    /** Она же «обновить»: `installVsix` внутри сносит прочие версии того же id. */
    public async install(id: string): Promise<IExtensionInstallResult> {
        try {
            // Зависимости ставятся без вопросов, как в VS Code, и тоже ждут перезагрузки окна.
            const { version, dependencies } = await installFromRegistry(this.source, id, {
                extensionsDir: this.profile.extensionsDir,
                host: this.host,
            });
            // В профиль — и зависимости, уже лежавшие на диске для другого профиля.
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
                // Нечего удалять — это не успех: карточка осталась бы с кнопкой
                // Uninstall, которая ничего не делает.
                return Promise.resolve({ ok: false, error: `Extension ${id} is not installed` });
            }
            this.markChanged(id);
            return Promise.resolve({ ok: true });
        } catch (error) {
            return Promise.resolve({ ok: false, error: messageOf(error) });
        }
    }

    /** Вклады сканируются один раз на старте — изменённое ждёт перезагрузки окна. */
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
            // Прошлый успешный индекс не выбрасываем: показать устаревший список
            // лучше, чем пустой, а причина видна отдельной строкой.
            this.catalogError = messageOf(error);
        }
        this.installed = this.profile.list();
        this.rebuildEntries();
    }

    private rebuildEntries(): void {
        this.entries = this.computeEntries();
        this.fireChange();
    }

    /** Запись реестра и установленное — одна карточка: иначе установленное из магазина показалось бы ещё раз как «мимо магазина». */
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
 * Несовместимость — по `latest.engines` (других версий в индексе нет) и сильнее «установлено»:
 * важнее знать, что обновляться некуда.
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

/** Поставлено мимо магазина: известен только манифест, запись всегда `installed`. */
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
