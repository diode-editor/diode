import type { IDisposable } from "@tuidom/core/common/disposable";
import { Disposable } from "@tuidom/core/common/disposable";
import type { IExtensionRegistrySource } from "../../../../platform/extensionManagement/common/iExtensionRegistrySource.ts";
import type {
    IRegistryExtensionMeta,
    IRegistryIndex,
    IRegistryIndexEntry,
} from "../../../../platform/extensionManagement/common/registryFormat.ts";
import { areEnginesCompatible } from "../../../../platform/extensionManagement/common/resolveCompatibleVersion.ts";
import type { IHostVersions } from "../../../../platform/extensionManagement/common/resolveCompatibleVersion.ts";
import type { IInstalledExtension } from "../../../../platform/extensionManagement/node/extensionInstaller.ts";
import {
    listInstalledExtensions,
    uninstallExtension,
} from "../../../../platform/extensionManagement/node/extensionInstaller.ts";
import { installFromRegistry } from "../../../../platform/extensionManagement/node/installFromRegistry.ts";
import type {
    ExtensionAvailability,
    IExtensionInstallResult,
    IExtensionListEntry,
    IExtensionOperationResult,
    IExtensionsWorkbenchService,
} from "../common/extensionsWorkbench.ts";

/**
 * Магазин для UI: каталог реестра, склеенный с установленным на диске.
 *
 * Живёт в `node/`, потому что ходит в сеть (через источник) и читает каталог
 * расширений; вьюлет знает только контракт из `common/`.
 *
 * Каталог кэшируется в памяти на сессию: индекс тянется один раз при первом
 * показе вьюлета, фильтрация локальная, а перечитывание — явный Refresh.
 * Дискового кэша с TTL нет сознательно — это отдельный слой хранения со своей
 * инвалидацией (см. docs/TODO/ExtensionsView.md).
 */
export class ExtensionsWorkbenchService extends Disposable implements IExtensionsWorkbenchService {
    private readonly listeners = new Set<() => void>();
    private readonly metaCache = new Map<string, IRegistryExtensionMeta | undefined>();
    /** Что ставили/удаляли в этой сессии: до перезагрузки окна вклады не поедут. */
    private readonly pendingReload = new Set<string>();

    private index: IRegistryIndex | null = null;
    // Оба поля наполняет конструктор: установленное известно сразу, без сети,
    // и «пустого» состояния у сервиса не бывает даже мгновение.
    private installed: readonly IInstalledExtension[];
    private catalogError: string | null = null;
    private entries: readonly IExtensionListEntry[];
    /** Первое чтение: null — ещё не начиналось. Держим промис, а не флаг, — параллельные показы ждут один фетч. */
    private loading: Promise<void> | null = null;

    public constructor(
        private readonly source: IExtensionRegistrySource,
        private readonly extensionsDir: string,
        private readonly host: IHostVersions,
    ) {
        super();
        // Установленное известно и без сети — читаем сразу, чтобы секция
        // INSTALLED была наполнена ещё до первого запроса к реестру.
        this.installed = listInstalledExtensions(extensionsDir);
        this.entries = this.computeEntries();
        this.register({ dispose: () => this.listeners.clear() });
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

    /**
     * Мета для страницы расширения. Кэшируется вместе с промахом (`undefined`):
     * «такого id в реестре нет» — тоже ответ, и переспрашивать его при каждом
     * открытии вкладки незачем. Сетевой сбой не кэшируется — он бросается
     * вызывающему, который покажет ошибку и даст повторить.
     */
    public async getMeta(id: string): Promise<IRegistryExtensionMeta | undefined> {
        if (this.metaCache.has(id)) return this.metaCache.get(id);
        const meta = await this.source.getMeta(id);
        this.metaCache.set(id, meta);
        return meta;
    }

    /**
     * Установка последней совместимой версии. Она же «обновить»: `installVsix`
     * внутри сносит прочие версии того же id, поэтому отдельной операции
     * обновления не существует.
     */
    public async install(id: string): Promise<IExtensionInstallResult> {
        try {
            const { version } = await installFromRegistry(this.source, id, {
                extensionsDir: this.extensionsDir,
                host: this.host,
            });
            this.markChanged(id);
            return { ok: true, version };
        } catch (error) {
            return { ok: false, error: messageOf(error) };
        }
    }

    /** Удаление всех установленных версий расширения. */
    public uninstall(id: string): Promise<IExtensionOperationResult> {
        try {
            const { removed } = uninstallExtension(id, this.extensionsDir);
            if (removed.length === 0) {
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

    /**
     * Состав установленного изменился: перечитываем диск и помечаем расширение
     * как ждущее перезагрузки окна — вклады сканируются один раз на старте.
     */
    private markChanged(id: string): void {
        this.pendingReload.add(id);
        this.reloadInstalled();
    }

    public onDidChange(listener: () => void): IDisposable {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }

    /** Перечитывает установленное с диска (после установки/удаления). */
    public reloadInstalled(): void {
        this.installed = listInstalledExtensions(this.extensionsDir);
        this.rebuildEntries();
    }

    private async load(): Promise<void> {
        try {
            this.index = await this.source.getIndex();
            this.catalogError = null;
        } catch (error) {
            // Прошлый успешный индекс не выбрасываем: показать устаревший список
            // лучше, чем пустой, а причина видна отдельной строкой.
            this.catalogError = messageOf(error);
        }
        this.installed = listInstalledExtensions(this.extensionsDir);
        this.rebuildEntries();
    }

    private rebuildEntries(): void {
        this.entries = this.computeEntries();
        this.fireChange();
    }

    /**
     * Склейка каталога и установленного: сначала записи реестра (порядок
     * индекса), затем установленное, которого в реестре нет. Запись, которая
     * есть и там и там, — одна карточка: иначе установленное из магазина
     * показалось бы ещё раз, уже как «мимо магазина».
     */
    private computeEntries(): readonly IExtensionListEntry[] {
        const installedById = new Map(this.installed.map((e) => [e.id, e]));
        const entries: IExtensionListEntry[] = [];
        for (const entry of this.index?.extensions ?? []) {
            entries.push(this.toCatalogEntry(entry, installedById.get(entry.id)));
            installedById.delete(entry.id);
        }
        for (const installed of installedById.values()) {
            entries.push(toSideloadedEntry(installed, this.pendingReload.has(installed.id)));
        }
        return entries;
    }

    private toCatalogEntry(entry: IRegistryIndexEntry, installed: IInstalledExtension | undefined): IExtensionListEntry {
        return {
            id: entry.id,
            publisher: entry.publisher,
            name: entry.name,
            displayName: entry.displayName,
            description: entry.description,
            kind: entry.kind,
            latestVersion: entry.latest.version,
            installedVersion: installed?.version ?? null,
            availability: availabilityOf(entry, installed, this.host),
            needsReload: this.pendingReload.has(entry.id),
        };
    }

    private fireChange(): void {
        for (const listener of [...this.listeners]) listener();
    }

}

/**
 * Состояние карточки реестра. Несовместимость проверяется по `latest.engines`
 * (в индексе других версий нет) и считается сильнее «установлено»: пользователю
 * важнее знать, что обновляться некуда, чем что версия старая.
 */
function availabilityOf(
    entry: IRegistryIndexEntry,
    installed: IInstalledExtension | undefined,
    host: IHostVersions,
): ExtensionAvailability {
    if (!areEnginesCompatible(entry.latest.engines, host)) return "incompatible";
    if (installed === undefined) return "available";
    return installed.version === entry.latest.version ? "installed" : "outdated";
}

/**
 * Карточка расширения, поставленного мимо магазина (`--install-extension foo.vsix`
 * или чужой каталог в `extensions/`): всё, что о нём известно, — его манифест.
 * Такая запись всегда `installed`: сравнивать не с чем.
 */
function toSideloadedEntry(installed: IInstalledExtension, needsReload: boolean): IExtensionListEntry {
    const dot = installed.id.indexOf(".");
    return {
        id: installed.id,
        publisher: installed.id.slice(0, dot),
        name: installed.id.slice(dot + 1),
        displayName: installed.displayName ?? installed.id,
        description: installed.description ?? "",
        kind: undefined,
        latestVersion: null,
        installedVersion: installed.version,
        availability: "installed",
        needsReload,
    };
}

/** Текст ошибки операции — то, что увидит пользователь на странице. */
function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
