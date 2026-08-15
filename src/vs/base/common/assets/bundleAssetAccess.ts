import { readBundleHeader, validateVirtualPath } from "./assetBundleFormat.ts";
import type { IAssetAccess, IAssetEntry } from "./iAssetAccess.ts";

/**
 * Реализация {@link IAssetAccess} поверх запечённого SEA-bundle.
 * Принимает буфер с содержимым `diode.bundle` (полученный через
 * `node:sea.getAsset("diode.bundle")`), парсит header однократно и затем
 * отдаёт срезы.
 */
export class BundleAssetAccess implements IAssetAccess {
    private readonly entries: ReadonlyMap<string, { offset: number; size: number }>;
    private readonly dataView: Uint8Array;
    /** Pre-computed children sets per directory prefix (`""`, `"a/"`, `"a/b/"`). */
    private readonly childrenByPrefix: ReadonlyMap<string, Map<string, boolean>>;

    public constructor(bundle: Uint8Array) {
        const { header, dataView } = readBundleHeader(bundle);
        this.dataView = dataView;
        const entries = new Map<string, { offset: number; size: number }>();
        for (const [virtualPath, entry] of Object.entries(header.files)) {
            entries.set(virtualPath, entry);
        }
        this.entries = entries;
        this.childrenByPrefix = buildPrefixIndex(entries.keys());
    }

    public read(virtualPath: string): Promise<Uint8Array> {
        validateVirtualPath(virtualPath);
        const entry = this.entries.get(virtualPath);
        if (entry === undefined) return Promise.reject(new Error(`Bundle entry not found: ${virtualPath}`));
        return Promise.resolve(this.dataView.subarray(entry.offset, entry.offset + entry.size));
    }

    public async readText(virtualPath: string): Promise<string> {
        return new TextDecoder("utf-8").decode(await this.read(virtualPath));
    }

    public exists(virtualPath: string): Promise<boolean> {
        try {
            validateVirtualPath(virtualPath);
        } catch {
            return Promise.resolve(false);
        }
        return Promise.resolve(this.entries.has(virtualPath));
    }

    public listEntries(virtualPrefix: string): Promise<IAssetEntry[]> {
        if (virtualPrefix.length > 0 && !virtualPrefix.endsWith("/")) {
            return Promise.reject(new Error(`listEntries prefix must end with "/" or be empty: ${virtualPrefix}`));
        }
        const children = this.childrenByPrefix.get(virtualPrefix);
        if (children === undefined) return Promise.resolve([]);
        return Promise.resolve(Array.from(children, ([name, isDirectory]) => ({ name, isDirectory })));
    }
}

function buildPrefixIndex(paths: Iterable<string>): Map<string, Map<string, boolean>> {
    const index = new Map<string, Map<string, boolean>>();
    for (const fullPath of paths) {
        const segments = fullPath.split("/");
        for (let i = 0; i < segments.length; i++) {
            const prefix = i === 0 ? "" : `${segments.slice(0, i).join("/")}/`;
            const name = segments[i];
            const isDirectory = i < segments.length - 1;
            let bucket = index.get(prefix);
            if (bucket === undefined) {
                bucket = new Map();
                index.set(prefix, bucket);
            }
            // Если name уже как файл, не "повышаем" до директории; если как директория,
            // не "понижаем" до файла. Совпадающие имена бывают только при битом bundle.
            const existing = bucket.get(name);
            if (existing === undefined) bucket.set(name, isDirectory);
            else if (existing !== isDirectory) {
                throw new Error(`Bundle path conflict: "${name}" is both file and directory under "${prefix}"`);
            }
        }
    }
    return index;
}
