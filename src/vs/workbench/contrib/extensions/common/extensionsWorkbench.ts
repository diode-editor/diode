import type { IDisposable } from "@tuidom/core/common/disposable";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IRegistryExtensionMeta, RegistryExtensionKind } from "../../../../platform/extensionManagement/common/registryFormat.ts";
import {
    matchesExtensionQuery,
    normalizeExtensionQuery,
} from "../../../../platform/extensionManagement/common/registryFormat.ts";

/**
 * Контракт магазина для UI (Extensions view): карточка списка, её состояние и
 * сервис, который эти карточки отдаёт.
 *
 * Контракт живёт в `common/`, а реализация — в `node/` (сеть + файловая система),
 * поэтому вьюлет из `browser/` зависит только от токена и типов. Иначе пришлось
 * бы разрешать импорт `browser → node` записью-исключением в
 * `scripts/check-layers.mjs`, а список таких исключений растить незачем.
 */

/**
 * Состояние карточки — то, что показывает бейдж строки и кнопка страницы:
 * - `available` — есть в реестре, не установлено, совместимо;
 * - `installed` — установлена версия, совпадающая с последней в реестре (или
 *   запись установлена мимо магазина — тогда {@link IExtensionListEntry.latestVersion} пуст);
 * - `outdated` — установлено, но в реестре есть версия новее;
 * - `incompatible` — последняя версия реестра не проходит `engines` этой сборки.
 */
export type ExtensionAvailability = "available" | "installed" | "outdated" | "incompatible";

/** Карточка списка: слияние записи индекса реестра и установленного на диске. */
export interface IExtensionListEntry {
    /** `publisher.name`. */
    readonly id: string;
    readonly publisher: string;
    readonly name: string;
    readonly displayName: string;
    readonly description: string;
    /** `undefined` — карточки нет в реестре (расширение поставлено мимо магазина). */
    readonly kind: RegistryExtensionKind | undefined;
    /** Последняя версия в реестре; `null` — записи в реестре нет. */
    readonly latestVersion: string | null;
    /** Установленная версия; `null` — не установлено. */
    readonly installedVersion: string | null;
    readonly availability: ExtensionAvailability;
}

/**
 * Магазин глазами workbench: каталог реестра, склеенный с установленным.
 * Сетевые сбои наружу не бросаются — каталог просто пуст, а причина лежит в
 * {@link getCatalogError}: установленные расширения видны и без сети.
 */
export interface IExtensionsWorkbenchService {
    /**
     * Первое чтение каталога; повторные вызовы ничего не делают. Зовётся при
     * первом показе вьюлета — на старте в сеть не ходим.
     */
    ensureLoaded(): Promise<void>;

    /** Явный Refresh: перечитать индекс реестра и список установленных. */
    refresh(): Promise<void>;

    /** Карточки: сначала записи реестра, затем установленное вне реестра. */
    getEntries(): readonly IExtensionListEntry[];

    /** Почему каталог пуст (текст сетевой ошибки), либо `null`. */
    getCatalogError(): string | null;

    /** Полная мета для страницы расширения; `undefined` — реестр не знает id. */
    getMeta(id: string): Promise<IRegistryExtensionMeta | undefined>;

    /** Состав карточек или ошибка каталога изменились. */
    onDidChange(listener: () => void): IDisposable;
}

export const ExtensionsWorkbenchServiceDIToken = token<IExtensionsWorkbenchService>("ExtensionsWorkbenchService");

/**
 * Фильтр списка по строке поиска — той же семантикой, что `searchRegistryIndex`
 * (общий предикат в `registryFormat.ts`): пустой запрос отдаёт всё.
 */
export function filterExtensionEntries(
    entries: readonly IExtensionListEntry[],
    query: string,
): IExtensionListEntry[] {
    const needle = normalizeExtensionQuery(query);
    return entries.filter((entry) => matchesExtensionQuery(entry, needle));
}
