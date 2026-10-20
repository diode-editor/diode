import {
    type IconvLite,
    type IEncodingInfo,
    loadIconv,
    resolveDecodeEncoding,
    resolveEncodeEncoding,
    stripBOM,
} from "./encoding.ts";

/**
 * Чтение и запись по кускам — то же, что разовые `decodeBuffer`/`encodeText`
 * (`encoding.ts`), но без буфера всего файла и строки всего текста: открытие
 * файла собирает документ из кусков чтения, сохранение кодирует снимок
 * документа (A4, docs/TODO/VscodeModel.md; у эталона —
 * `createTextBufferFactoryFromStream` и `toEncodeReadable`). Правила кодировок
 * — те же функции `encoding.ts`; равенство разовому пути держат тесты
 * `encodingStream.test.ts` на всех разрезах. Отдельным модулем — чтобы
 * extension host, которому нужен только разовый декод, не тащил это в свою роль.
 */

/**
 * Streaming decoder: disk bytes in, text out, chunk by chunk. Whatever the
 * chunk boundaries, the joined output is the one-shot decode of the joined
 * input — a boundary may cut a multi-byte sequence, the decoder carries the cut
 * part over to the next chunk.
 */
interface IChunkDecoder {
    write(chunk: Buffer): string;
    end(): string;
}

/** Streaming encoder, the mirror of {@link IChunkDecoder}: a chunk may end mid surrogate pair. */
interface IChunkEncoder {
    write(text: string): Buffer;
    end(): Buffer;
}

interface IStreamCodec {
    createDecoder(): IChunkDecoder;
    createEncoder(): IChunkEncoder;
}

/**
 * How many trailing bytes of `bytes` are a utf-8 sequence still waiting for
 * its continuation bytes (0 — the chunk ends on a sequence boundary). Carrying
 * them over never changes the decode: a lead byte always starts a new maximal
 * subpart, so cutting right before it splits nothing the one-shot decoder
 * would have read as one character.
 */
function utf8IncompleteTail(bytes: Buffer): number {
    const stop = Math.max(0, bytes.length - 3);
    for (let i = bytes.length - 1; i >= stop; i--) {
        const byte = bytes[i];
        // Байт продолжения (10xxxxxx) — ищем ведущий дальше влево.
        if ((byte & 0xc0) === 0x80) continue;
        const expected = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
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
            // Копия хвоста: буфер чтения вызывающий может переиспользовать.
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
 * UTF-16 by code units: a pair split by the chunk boundary decodes as two lone
 * code units that join back into the pair — only an odd byte needs carrying.
 * BE has no node decoder: swap the bytes of each pair and read as LE (a copy,
 * the caller's buffer stays intact). The odd trailing byte of the whole input
 * is dropped, as iconv-lite does.
 */
function createUtf16Decoder(bigEndian: boolean): IChunkDecoder {
    let pending: Buffer | null = null;
    return {
        write(chunk) {
            const bytes = pending === null ? chunk : Buffer.concat([pending, chunk]);
            const even = bytes.length & ~1;
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

/**
 * Encoder over a one-shot `encode`: a trailing high surrogate waits for the
 * next chunk — encoded alone, its pair would become two replacement sequences
 * in utf-8 instead of one 4-byte character.
 */
function createNativeEncoder(encode: (text: string) => Buffer): IChunkEncoder {
    let pending = "";
    return {
        write(text) {
            const joined = pending + text;
            const last = joined.charCodeAt(joined.length - 1);
            const cut = last >= 0xd800 && last <= 0xdbff ? joined.length - 1 : joined.length;
            pending = joined.slice(cut);
            return encode(joined.slice(0, cut));
        },
        end() {
            const rest = pending;
            pending = "";
            return encode(rest);
        },
    };
}

/** Streaming native codecs by iconv name — the same set as the one-shot ones of `encoding.ts`. */
const STREAM_CODECS: ReadonlyMap<string, IStreamCodec> = new Map<string, IStreamCodec>([
    [
        "utf8",
        {
            createDecoder: createUtf8Decoder,
            // Stryker disable next-line StringLiteral: Buffer.from с пустым именем кодировки — тоже utf-8
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
 * iconv-lite one-shot behind the streaming interface: the chunks are gathered
 * and decoded at the end. Its own stream decoder is not chunk-safe — gb18030
 * (iconv-lite 0.7.3) loses characters when a chunk boundary cuts a 4-byte
 * sequence. Non-Unicode charsets come only from an explicit «Reopen with
 * Encoding», so the whole buffer here costs nothing on the open path.
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

/** iconv-lite one-shot behind the streaming interface — same reason as {@link iconvDecoder}. */
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

/** Document text decoded from disk bytes in chunks, plus the encoding id it is read in. */
export interface IDecodedStream {
    /** Table id (`SUPPORTED_ENCODINGS`), never an iconv name. */
    readonly encoding: string;
    /**
     * The text in chunks, BOM stripped; joined — exactly the one-shot decode.
     * Lazy and single-pass: iterating it pulls the byte chunks.
     */
    readonly text: Iterable<string>;
}

/** Longest BOM (utf-8) — how many bytes the sniff needs. */
const SNIFF_LENGTH = 3;

/**
 * The first chunks of `bytes`, glued until there are enough bytes for the BOM
 * sniff or the input ends.
 */
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
        // Брошенный на полпути проход закрывает и источник байт (файл).
        rest.return?.();
    }
}

function streamCodec(info: IEncodingInfo): IStreamCodec {
    const codec = STREAM_CODECS.get(info.iconvName);
    /* v8 ignore start -- сниф даёт только utf8/utf8bom/utf16le/utf16be, у всех есть нативный кодек; throw — инвариант-гард */
    // Stryker disable next-line all: недостижимый инвариант-гард, см. v8 ignore выше
    if (codec === undefined) throw new Error(`No native codec for sniffed encoding: ${info.id}`);
    /* v8 ignore stop */
    return codec;
}

/**
 * Decodes disk bytes, arriving in chunks, by the BOM sniff alone — opening a
 * file, no explicit encoding. The chunked form of `decodeBufferByBOM`:
 * synchronous and iconv-free (the sniff only ever yields utf-8 or UTF-16), the
 * BOM is stripped.
 */
export function decodeStreamByBOM(bytes: Iterable<Buffer>): IDecodedStream {
    const source = bytes[Symbol.iterator]();
    const head = readHead(source);
    const info = resolveDecodeEncoding(head, undefined);
    return { encoding: info.id, text: decodeChunks(stripBOM(head, info), source, streamCodec(info).createDecoder()) };
}

/**
 * Decodes disk bytes arriving in chunks — the chunked form of `decodeBuffer`,
 * same encoding rules. Asynchronous only to load iconv-lite: the bytes are
 * read as {@link IDecodedStream.text} is iterated.
 */
export async function decodeStream(bytes: Iterable<Buffer>, explicitEncoding?: string): Promise<IDecodedStream> {
    const source = bytes[Symbol.iterator]();
    const head = readHead(source);
    const info = resolveDecodeEncoding(head, explicitEncoding);
    const codec = STREAM_CODECS.get(info.iconvName);
    let decoder: IChunkDecoder;
    try {
        decoder = codec !== undefined ? codec.createDecoder() : iconvDecoder(await loadIconv(), info.iconvName);
    } catch (error) {
        // Источник уже начат (сниф) — отказ загрузки iconv его закрывает.
        source.return?.();
        throw error;
    }
    return { encoding: info.id, text: decodeChunks(stripBOM(head, info), source, decoder) };
}

/**
 * Encodes document text arriving in chunks (a document snapshot,
 * `TextDocument.createSnapshot`) — the chunked form of `encodeText`, same BOM
 * policy and fallback, and no string of the whole document is ever built
 * (`toEncodeReadable` of the reference). A chunk may end mid surrogate pair.
 * The chunks are read after iconv-lite is loaded, so a snapshot must already be
 * taken.
 */
export async function encodeChunks(chunks: Iterable<string>, encoding: string): Promise<Buffer> {
    const info = resolveEncodeEncoding(encoding);
    const codec = STREAM_CODECS.get(info.iconvName);
    // addBOM, как и stripBOM в decodeBuffer, у не-Unicode кодеков пустой.
    const encoder = codec !== undefined ? codec.createEncoder() : iconvEncoder(await loadIconv(), info.iconvName);
    const parts: Buffer[] = info.bom === undefined ? [] : [Buffer.from(info.bom)];
    for (const chunk of chunks) parts.push(encoder.write(chunk));
    parts.push(encoder.end());
    return Buffer.concat(parts);
}
