import {
    type IconvLite,
    type IEncodingInfo,
    loadIconv,
    resolveDecodeEncoding,
    resolveEncodeEncoding,
    stripBOM,
} from "./encoding.ts";

// A module separate from `encoding.ts` so the extension host, which only needs one-shot
// decoding, does not pull this into its role.

/** For any chunk boundaries, the joined output equals a one-shot decode of the joined input. */
interface IChunkDecoder {
    write(chunk: Buffer): string;
    end(): string;
}

/** A chunk may end in the middle of a surrogate pair. */
interface IChunkEncoder {
    write(text: string): Buffer;
    end(): Buffer;
}

interface IStreamCodec {
    createDecoder(): IChunkDecoder;
    createEncoder(): IChunkEncoder;
}

/**
 * Carrying the tail over does not change decoding: a lead byte always starts a new maximal
 * subpart, so a cut before it splits nothing a one-shot decoder would read as one character.
 */
function utf8IncompleteTail(bytes: Buffer): number {
    // Stryker disable next-line MethodExpression: without the lower bound the loop goes further left, but a lead byte there is more than 4 from the end, so the tail is 0, same as after the loop
    const stop = Math.max(0, bytes.length - 3);
    for (let i = bytes.length - 1; i >= stop; i--) {
        const byte = bytes[i];
        if ((byte & 0xc0) === 0x80) continue;
        // C0/C1 never start a valid sequence: U+FFFD right away.
        const expected = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc2 ? 2 : 1;
        const present = bytes.length - i;
        return present < expected ? present : 0;
    }
    return 0;
}

function createUtf8Decoder(): IChunkDecoder {
    let pending: Buffer | null = null;
    return {
        write(chunk) {
            const bytes = pending === null ? chunk : Buffer.concat([pending, chunk]);
            const cut = bytes.length - utf8IncompleteTail(bytes);
            // Copy the tail: the caller may reuse its read buffer.
            // Stryker disable next-line ConditionalExpression,EqualityOperator: an empty tail buffer instead of null decodes the same, null only saves a copy
            pending = cut < bytes.length ? Buffer.from(bytes.subarray(cut)) : null;
            return bytes.toString("utf8", 0, cut);
        },
        end() {
            const rest = pending;
            pending = null;
            return rest === null ? "" : rest.toString("utf8");
        },
    };
}

/**
 * A split pair decodes as two lone code units and joins back, so only an odd byte needs
 * carrying over. An odd byte at the very end of input is dropped, as in iconv-lite.
 * BE swaps a copy (swap16): the caller's buffer stays intact.
 */
function createUtf16Decoder(bigEndian: boolean): IChunkDecoder {
    let pending: Buffer | null = null;
    return {
        write(chunk) {
            const bytes = pending === null ? chunk : Buffer.concat([pending, chunk]);
            const even = bytes.length & ~1;
            // Stryker disable next-line ConditionalExpression,EqualityOperator: an empty tail buffer instead of null decodes the same, null only saves a copy
            pending = even < bytes.length ? Buffer.from(bytes.subarray(even)) : null;
            const units = bytes.subarray(0, even);
            return (bigEndian ? Buffer.from(units).swap16() : units).toString("utf16le");
        },
        end() {
            pending = null;
            return "";
        },
    };
}

/** A trailing high surrogate waits for the next chunk: alone it would become a replacement char in utf-8. */
function createNativeEncoder(encode: (text: string) => Buffer): IChunkEncoder {
    let pending = "";
    return {
        write(text) {
            const joined = pending + text;
            const last = joined.charCodeAt(joined.length - 1);
            // Stryker disable next-line ConditionalExpression: "hold back any last char" yields the same total bytes, only the chunk split differs
            const cut = last >= 0xd800 && last <= 0xdbff ? joined.length - 1 : joined.length;
            pending = joined.slice(cut);
            return encode(joined.slice(0, cut));
        },
        end() {
            return encode(pending);
        },
    };
}

const STREAM_CODECS: ReadonlyMap<string, IStreamCodec> = new Map<string, IStreamCodec>([
    [
        "utf8",
        {
            createDecoder: createUtf8Decoder,
            // Stryker disable next-line StringLiteral: Buffer.from with an empty encoding name is utf-8 too
            createEncoder: () => createNativeEncoder((text) => Buffer.from(text, "utf8")),
        },
    ],
    [
        "utf16le",
        {
            createDecoder: () => createUtf16Decoder(false),
            createEncoder: () => createNativeEncoder((text) => Buffer.from(text, "utf16le")),
        },
    ],
    [
        "utf16be",
        {
            createDecoder: () => createUtf16Decoder(true),
            createEncoder: () => createNativeEncoder((text) => Buffer.from(text, "utf16le").swap16()),
        },
    ],
]);

/**
 * Accumulates chunks and decodes at once: the iconv-lite 0.7.3 streaming decoder loses
 * gb18030 characters at a cut. Non-Unicode only comes from an explicit "Reopen with
 * Encoding", so buffering the whole file costs file open nothing.
 */
function iconvDecoder(iconv: IconvLite, iconvName: string): IChunkDecoder {
    const parts: Buffer[] = [];
    return {
        write(chunk) {
            parts.push(chunk);
            return "";
        },
        end: () => iconv.decode(Buffer.concat(parts), iconvName),
    };
}

function iconvEncoder(iconv: IconvLite, iconvName: string): IChunkEncoder {
    const parts: string[] = [];
    return {
        write(text) {
            parts.push(text);
            return Buffer.alloc(0);
        },
        end: () => iconv.encode(parts.join(""), iconvName),
    };
}

export interface IDecodedStream {
    /** Id from the `SUPPORTED_ENCODINGS` table, not the iconv name. */
    readonly encoding: string;
    /** Lazy and single-pass: iteration pulls byte chunks. */
    readonly text: Iterable<string>;
}

/** The longest BOM (utf-8). */
const SNIFF_LENGTH = 3;

function readHead(bytes: Iterator<Buffer>): Buffer {
    const parts: Buffer[] = [];
    let length = 0;
    while (length < SNIFF_LENGTH) {
        const next = bytes.next();
        if (next.done === true) break;
        parts.push(next.value);
        length += next.value.length;
    }
    return Buffer.concat(parts);
}

function* decodeChunks(head: Buffer, rest: Iterator<Buffer>, decoder: IChunkDecoder): Generator<string> {
    try {
        yield decoder.write(head);
        for (let next = rest.next(); next.done !== true; next = rest.next()) yield decoder.write(next.value);
        yield decoder.end();
    } finally {
        // A pass abandoned midway also closes the byte source (the file).
        rest.return?.();
    }
}

function streamCodec(info: IEncodingInfo): IStreamCodec {
    const codec = STREAM_CODECS.get(info.iconvName);
    /* v8 ignore start -- sniffing yields only utf8/utf8bom/utf16le/utf16be, all with a native codec; the throw is an invariant guard */
    // Stryker disable next-line all: unreachable invariant guard, see v8 ignore above
    if (codec === undefined) throw new Error(`No native codec for sniffed encoding: ${info.id}`);
    /* v8 ignore stop */
    return codec;
}

/** Synchronous and iconv-free: sniffing yields only utf-8 or UTF-16. */
export function decodeStreamByBOM(bytes: Iterable<Buffer>): IDecodedStream {
    const source = bytes[Symbol.iterator]();
    const head = readHead(source);
    const info = resolveDecodeEncoding(head, undefined);
    return { encoding: info.id, text: decodeChunks(stripBOM(head, info), source, streamCodec(info).createDecoder()) };
}

/** Async only to load iconv-lite: bytes are read while iterating {@link IDecodedStream.text}. */
export async function decodeStream(bytes: Iterable<Buffer>, explicitEncoding?: string): Promise<IDecodedStream> {
    const source = bytes[Symbol.iterator]();
    const head = readHead(source);
    const info = resolveDecodeEncoding(head, explicitEncoding);
    const codec = STREAM_CODECS.get(info.iconvName);
    let decoder: IChunkDecoder;
    try {
        decoder = codec !== undefined ? codec.createDecoder() : iconvDecoder(await loadIconv(), info.iconvName);
    } catch (error) {
        // The source is already started (sniffing); a failed iconv load closes it.
        source.return?.();
        throw error;
    }
    return { encoding: info.id, text: decodeChunks(stripBOM(head, info), source, decoder) };
}

/** Chunks are read after iconv-lite loads, so the snapshot must already be taken. */
export async function encodeChunks(chunks: Iterable<string>, encoding: string): Promise<Buffer> {
    const info = resolveEncodeEncoding(encoding);
    const codec = STREAM_CODECS.get(info.iconvName);
    // Like stripBOM in decodeBuffer, addBOM is a no-op for non-Unicode codecs.
    const encoder = codec !== undefined ? codec.createEncoder() : iconvEncoder(await loadIconv(), info.iconvName);
    const parts: Buffer[] = info.bom === undefined ? [] : [Buffer.from(info.bom)];
    for (const chunk of chunks) parts.push(encoder.write(chunk));
    parts.push(encoder.end());
    return Buffer.concat(parts);
}
