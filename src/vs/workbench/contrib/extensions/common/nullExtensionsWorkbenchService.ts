import type { IExtensionsWorkbenchService } from "./extensionsWorkbench.ts";

/**
 * Пустой магазин: каталога нет, ошибок нет, событий нет. Для тестового профиля
 * DI и любого места, где вьюлет нужен собранным, но ходить в сеть и на диск
 * незачем (аналог `NULL_STATE_SERVICE`).
 *
 * Фабрика, а не готовый объект: каждый контейнер получает свой экземпляр, и
 * общий singleton не тащит состояние между тестами.
 */
export function createNullExtensionsWorkbenchService(): IExtensionsWorkbenchService {
    return {
        ensureLoaded: () => Promise.resolve(),
        refresh: () => Promise.resolve(),
        getEntries: () => [],
        getCatalogError: () => null,
        getMeta: () => Promise.resolve(undefined),
        onDidChange: () => ({ dispose: () => {} }),
    };
}
