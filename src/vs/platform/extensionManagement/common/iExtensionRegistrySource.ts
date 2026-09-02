import type { IRegistryExtensionMeta, IRegistryIndex, IRegistryVersion } from "./registryFormat.ts";

/**
 * Источник реестра расширений: откуда клиент читает индекс/мету и получает
 * `.vsix`-артефакты. Реализации взаимозаменяемы: файловая (каталог в
 * публикуемом формате registry-репозитория — тесты, система тестирования
 * расширений, оффлайн) сейчас, HTTP (GitHub Pages registry-репозитория) позже.
 */
export interface IExtensionRegistrySource {
    /** Прочитать индекс реестра (компактный список для поиска/view). */
    getIndex(): Promise<IRegistryIndex>;

    /** Полная мета расширения; `undefined` — реестр не знает такого id. */
    getMeta(id: string): Promise<IRegistryExtensionMeta | undefined>;

    /**
     * Материализует артефакт версии как локальный `.vsix` и возвращает
     * абсолютный путь к нему. `tempDir` — каталог вызывающего для скачиваемых
     * байтов; файловый источник вправе вернуть путь к уже существующему файлу,
     * ничего не копируя. Владение `tempDir` и его очистка — на вызывающем;
     * проверка sha256 полученного файла — тоже (одинакова для всех источников).
     */
    fetchArtifact(version: IRegistryVersion, tempDir: string): Promise<string>;
}
