import type { IAssetAccess, IAssetEntry } from "./iAssetAccess.ts";

/**
 * Композитный {@link IAssetAccess}, маршрутизирующий запросы по виртуальному
 * префиксу пути. Используется, когда часть ассетов лежит в SEA-bundle
 * (builtin расширения), а часть — на диске (внешние расширения из
 * `~/.diode/extensions/`).
 *
 * Правила:
 *   - Для каждого backend задан виртуальный префикс, заканчивающийся на `/`
 *     (или пустая строка `""` как fallback на весь диапазон путей).
 *   - Запросы (`read/readText/exists/listEntries`) направляются в backend
 *     с самым длинным совпадающим префиксом.
 *   - Если ни один префикс не подошёл, метод бросает исключение
 *     (`exists` — возвращает `false`).
 */
export class CompositeAssetAccess implements IAssetAccess {
    private readonly routes: readonly (readonly [string, IAssetAccess])[];

    public constructor(routes: Readonly<Record<string, IAssetAccess>>) {
        for (const prefix of Object.keys(routes)) {
            if (prefix.length > 0 && !prefix.endsWith("/")) {
                throw new Error(`CompositeAssetAccess prefix must end with "/" or be empty: ${prefix}`);
            }
        }
        // Сортируем по убыванию длины префикса — более специфичный побеждает.
        this.routes = Object.entries(routes).sort((a, b) => b[0].length - a[0].length);
    }

    public async read(virtualPath: string): Promise<Uint8Array> {
        return this.pick(virtualPath).read(virtualPath);
    }

    public async readText(virtualPath: string): Promise<string> {
        return this.pick(virtualPath).readText(virtualPath);
    }

    public async exists(virtualPath: string): Promise<boolean> {
        const backend = this.tryPick(virtualPath);
        if (backend === undefined) return false;
        return backend.exists(virtualPath);
    }

    public async listEntries(virtualPrefix: string): Promise<IAssetEntry[]> {
        const backend = this.tryPick(virtualPrefix);
        if (backend === undefined) return [];
        return backend.listEntries(virtualPrefix);
    }

    private pick(virtualPath: string): IAssetAccess {
        const backend = this.tryPick(virtualPath);
        if (backend === undefined) {
            throw new Error(`No CompositeAssetAccess route for virtual path: ${virtualPath}`);
        }
        return backend;
    }

    private tryPick(virtualPath: string): IAssetAccess | undefined {
        for (const [prefix, backend] of this.routes) {
            if (prefix === "" || virtualPath === prefix || virtualPath.startsWith(prefix)) {
                return backend;
            }
        }
        return undefined;
    }
}
