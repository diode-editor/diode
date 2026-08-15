/**
 * Бинарный формат бандла ассетов для SEA-сборки.
 *
 * Layout:
 * ```
 *   [magic 8B "DIODEBND"]
 *   [headerLength uint32 LE]
 *   [header JSON UTF-8]
 *   [data ...]
 * ```
 *
 * Header — `IBundleHeader`. `offset` отсчитывается от начала data-секции
 * (т.е. data-секция = байты после заголовка).
 *
 * Формат намеренно тривиальный: zero deps, легко продублировать в
 * build-скрипте на mjs (см. `scripts/pack-assets.mjs`).
 */

const MAGIC = new Uint8Array([0x44, 0x49, 0x4f, 0x44, 0x45, 0x42, 0x4e, 0x44]); // "DIODEBND"
const MAGIC_LEN = MAGIC.length;
const HEADER_LEN_SIZE = 4;

export interface IBundleHeader {
    readonly version: 1;
    readonly files: Readonly<Record<string, IBundleFileEntry>>;
}

export interface IBundleFileEntry {
    readonly offset: number;
    readonly size: number;
}

export interface IPackInput {
    readonly virtualPath: string;
    readonly data: Uint8Array;
}

export function packBundle(inputs: readonly IPackInput[]): Uint8Array {
    const files: Record<string, IBundleFileEntry> = {};
    let dataSize = 0;
    for (const input of inputs) {
        validateVirtualPath(input.virtualPath);
        if (Object.prototype.hasOwnProperty.call(files, input.virtualPath)) {
            throw new Error(`Duplicate bundle entry: ${input.virtualPath}`);
        }
        files[input.virtualPath] = { offset: dataSize, size: input.data.length };
        dataSize += input.data.length;
    }

    const header: IBundleHeader = { version: 1, files };
    const headerJson = new TextEncoder().encode(JSON.stringify(header));

    const total = MAGIC_LEN + HEADER_LEN_SIZE + headerJson.length + dataSize;
    const out = new Uint8Array(total);
    out.set(MAGIC, 0);
    new DataView(out.buffer, out.byteOffset, out.byteLength).setUint32(
        MAGIC_LEN,
        headerJson.length,
        /* littleEndian */ true,
    );
    out.set(headerJson, MAGIC_LEN + HEADER_LEN_SIZE);

    let cursor = MAGIC_LEN + HEADER_LEN_SIZE + headerJson.length;
    for (const input of inputs) {
        out.set(input.data, cursor);
        cursor += input.data.length;
    }
    return out;
}

export interface IUnpackedBundle {
    readonly header: IBundleHeader;
    /** Срез исходного буфера, представляющий data-секцию. */
    readonly dataView: Uint8Array;
}

export function readBundleHeader(buffer: Uint8Array): IUnpackedBundle {
    if (buffer.length < MAGIC_LEN + HEADER_LEN_SIZE) {
        throw new Error("Bundle too small to contain header");
    }
    for (let i = 0; i < MAGIC_LEN; i++) {
        if (buffer[i] !== MAGIC[i]) throw new Error("Bundle magic mismatch");
    }
    const headerLen = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getUint32(
        MAGIC_LEN,
        /* littleEndian */ true,
    );
    const headerStart = MAGIC_LEN + HEADER_LEN_SIZE;
    const headerEnd = headerStart + headerLen;
    if (buffer.length < headerEnd) {
        throw new Error("Bundle truncated: header length exceeds buffer");
    }
    const headerJson = new TextDecoder("utf-8").decode(buffer.subarray(headerStart, headerEnd));
    const header = JSON.parse(headerJson) as IBundleHeader;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (header.version !== 1) throw new Error(`Unsupported bundle version: ${String(header.version)}`);
    return {
        header,
        dataView: buffer.subarray(headerEnd),
    };
}

export function validateVirtualPath(virtualPath: string): void {
    if (virtualPath.length === 0) throw new Error("Virtual path must not be empty");
    if (virtualPath.startsWith("/")) throw new Error(`Virtual path must not start with "/": ${virtualPath}`);
    if (virtualPath.endsWith("/")) throw new Error(`Virtual path must not end with "/": ${virtualPath}`);
    for (const segment of virtualPath.split("/")) {
        if (segment === "" || segment === "." || segment === "..") {
            throw new Error(`Invalid segment in virtual path: ${virtualPath}`);
        }
    }
}

/**
 * POSIX-join для виртуальных путей. Не поддерживает `..`, не нормализует
 * `.`, просто склеивает с одним `/` между частями.
 */
export function joinVirtualPath(prefix: string, relative: string): string {
    if (prefix.length === 0) return relative.replace(/^\.\//, "");
    const cleanPrefix = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
    const cleanRel = relative.startsWith("./") ? relative.slice(2) : relative;
    return `${cleanPrefix}/${cleanRel}`;
}
