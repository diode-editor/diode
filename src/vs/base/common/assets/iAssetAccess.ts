/**
 * Ассеты из FS (dev, тесты) или из бандла SEA-бинаря. Пути — POSIX, без
 * ведущего `/` и без сегментов `..`.
 */
export interface IAssetAccess {
    /** Отклоняет, если ассет отсутствует. */
    read(virtualPath: string): Promise<Uint8Array>;

    /** UTF-8. Отклоняет, если ассет отсутствует. */
    readText(virtualPath: string): Promise<string>;

    exists(virtualPath: string): Promise<boolean>;

    /** Только непосредственные дети; `virtualPrefix` — пустой или с `/` на конце. */
    listEntries(virtualPrefix: string): Promise<IAssetEntry[]>;
}

export interface IAssetEntry {
    readonly name: string;
    readonly isDirectory: boolean;
}
