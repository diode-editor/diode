/**
 * Абстракция доступа к статическим ассетам (грамматики, `onig.wasm`,
 * манифесты builtin-расширений). Скрывает разницу между двумя режимами:
 *
 *   - **dev/tests** — `FsAssetAccess`: ассеты лежат в реальной FS
 *     (`src/Extensions/builtin/...`, `node_modules/vscode-oniguruma/...`).
 *   - **production SEA-бинарь** — `BundleAssetAccess`: ассеты упакованы
 *     в один встроенный SEA-asset (`diode.bundle`) кастомного формата
 *     {@link AssetBundleFormat}.
 *
 * Все пути — POSIX-style (`/` как разделитель, без leading `/`).
 * Реализация валидирует пути и не должна допускать `..` сегменты.
 */
export interface IAssetAccess {
    /** Прочитать бинарное содержимое ассета. Отклоняет, если ассет отсутствует. */
    read(virtualPath: string): Promise<Uint8Array>;

    /** Прочитать текстовое содержимое (UTF-8). Отклоняет, если ассет отсутствует. */
    readText(virtualPath: string): Promise<string>;

    /** Существует ли файл по этому виртуальному пути. */
    exists(virtualPath: string): Promise<boolean>;

    /**
     * Перечислить непосредственные дочерние записи указанного префикса.
     * `virtualPrefix` должен заканчиваться на `/` или быть пустой строкой.
     */
    listEntries(virtualPrefix: string): Promise<IAssetEntry[]>;
}

export interface IAssetEntry {
    readonly name: string;
    readonly isDirectory: boolean;
}
