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

// Контракт в `common/`, реализация в `node/`: иначе вьюлету из `browser/` понадобилось бы
// исключение `browser → node` в scripts/check-layers.mjs.

/**
 * `installed` — версия совпадает с последней в реестре либо запись мимо магазина (`latestVersion` пуст);
 * `incompatible` — последняя версия реестра не проходит `engines` этой сборки.
 */
export type ExtensionAvailability = "available" | "installed" | "outdated" | "incompatible";

export interface IExtensionListEntry {
    /** `publisher.name`. */
    readonly id: string;
    readonly publisher: string;
    readonly name: string;
    readonly displayName: string;
    readonly description: string;
    /** `undefined` — карточки нет в реестре (расширение поставлено мимо магазина). */
    readonly kind: RegistryExtensionKind | undefined;
    /** `undefined` — записи в реестре нет либо реестр пометку не проставил. */
    readonly support: IRegistrySupport | undefined;
    /** Последняя версия в реестре; `null` — записи в реестре нет. */
    readonly latestVersion: string | null;
    /** Установленная версия; `null` — не установлено. */
    readonly installedVersion: string | null;
    readonly availability: ExtensionAvailability;
    /** Ставили/удаляли в этой сессии: вклады сканируются один раз на старте, заработает после перезагрузки окна. */
    readonly needsReload: boolean;
}

/** Ошибка — значение, а не исключение: причина едет в UI текстом, как и ошибка чтения каталога. */
export type IExtensionOperationResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

export type IExtensionInstallResult =
    | { readonly ok: true; readonly version: string }
    | { readonly ok: false; readonly error: string };

/** Сетевые сбои наружу не бросаются: каталог пуст, причина — в {@link getCatalogError}. */
export interface IExtensionsWorkbenchService {
    /** Зовётся при первом показе вьюлета — на старте в сеть не ходим; повторные вызовы ничего не делают. */
    ensureLoaded(): Promise<void>;

    refresh(): Promise<void>;

    /** Карточки: сначала записи реестра, затем установленное вне реестра. */
    getEntries(): readonly IExtensionListEntry[];

    getCatalogError(): string | null;

    /** Полная мета для страницы расширения; `undefined` — реестр не знает id. */
    getMeta(id: string): Promise<IRegistryExtensionMeta | undefined>;

    /** Она же «обновить»: прежние версии того же id сносятся — версия одна на все профили. */
    install(id: string): Promise<IExtensionInstallResult>;

    /** С диска (все версии) — когда расширение не нужно ни одному профилю. */
    uninstall(id: string): Promise<IExtensionOperationResult>;

    onDidChange(listener: () => void): IDisposable;
}

export const ExtensionsWorkbenchServiceDIToken = token<IExtensionsWorkbenchService>("ExtensionsWorkbenchService");

/** Семантика `searchRegistryIndex` (общий предикат в `registryFormat.ts`). */
export function filterExtensionEntries(entries: readonly IExtensionListEntry[], query: string): IExtensionListEntry[] {
    const needle = normalizeExtensionQuery(query);
    return entries.filter((entry) => matchesExtensionQuery(entry, needle));
}
