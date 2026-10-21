import {
    type IconvLite,
    type IEncodingInfo,
    loadIconv,
    resolveDecodeEncoding,
    resolveEncodeEncoding,
    stripBOM,
} from "./encoding.ts";

// Отдельным от `encoding.ts` модулем — чтобы extension host, которому нужен
// только разовый декод, не тащил это в свою роль.

/** Склеенный выход при любых границах кусков — ровно разовый декод склеенного входа. */
interface IChunkDecoder {
    write(chunk: Buffer): string;
    end(): string;
}

/** Кусок может кончаться посреди суррогатной пары. */
interface IChunkEncoder {
    write(text: string): Buffer;
    end(): Buffer;
}

interface IStreamCodec {
    createDecoder(): IChunkDecoder;
    createEncoder(): IChunkEncoder;
}

/**
 * Перенос хвоста декод не меняет: ведущий байт всегда начинает новую maximal
 * subpart, разрез перед ним не делит ничего, что разовый декодер прочёл бы одним символом.
 */
function utf8IncompleteTail(bytes: Buffer): number {
    // Stryker disable next-line MethodExpression: без нижней границы цикл идёт левее, но ведущий байт там отстоит от конца больше чем на 4 — хвост 0, как и после цикла
    const stop = Math.max(0, bytes.length - 3);
    for (let i = bytes.length - 1; i >= stop; i--) {
        const byte = bytes[i];
        if ((byte & 0xc0) === 0x80) continue;
        // C0/C1 никогда не начинают допустимую последовательность — U+FFFD сразу.
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
            // Копия хвоста: буфер чтения вызывающий может переиспользовать.
            // Stryker disable next-line ConditionalExpression,EqualityOperator: пустой хвост буфером вместо null — тот же декод, null лишь экономит копию
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
 * Разрезанная пара декодируется двумя одиночными code unit'ами и склеивается
 * обратно — переносить нужно только нечётный байт. Нечётный байт в конце всего
 * входа отбрасывается, как у iconv-lite. BE — swap16 копии: буфер вызывающего цел.
 */
function createUtf16Decoder(bigEndian: boolean): IChunkDecoder {
    let pending: Buffer | null = null;
    return {
        write(chunk) {
            const bytes = pending === null ? chunk : Buffer.concat([pending, chunk]);
            const even = bytes.length & ~1;
            // Stryker disable next-line ConditionalExpression,EqualityOperator: пустой хвост буфером вместо null — тот же декод, null лишь экономит копию
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

/** Хвостовой high surrogate ждёт следующего куска: один он стал бы заменой в utf-8. */
function createNativeEncoder(encode: (text: string) => Buffer): IChunkEncoder {
    let pending = "";
    return {
        write(text) {
            const joined = pending + text;
            const last = joined.charCodeAt(joined.length - 1);
            // Stryker disable next-line ConditionalExpression: «придержать любой последний символ» даёт те же байты в сумме — отличие только в разбивке по кускам
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
 * Копит куски и декодирует разом: потоковый декодер iconv-lite 0.7.3 теряет
 * символы gb18030 на разрезе. Не-Unicode бывает только по явному «Reopen with
 * Encoding», так что открытию файла буфер целиком ничего не стоит.
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
    /** Id таблицы `SUPPORTED_ENCODINGS`, не имя iconv. */
    readonly encoding: string;
    /** Ленивый и однопроходный: итерация тянет куски байт. */
    readonly text: Iterable<string>;
}

/** Самый длинный BOM (utf-8). */
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

/** Синхронно и без iconv: сниф даёт только utf-8 или UTF-16. */
export function decodeStreamByBOM(bytes: Iterable<Buffer>): IDecodedStream {
    const source = bytes[Symbol.iterator]();
    const head = readHead(source);
    const info = resolveDecodeEncoding(head, undefined);
    return { encoding: info.id, text: decodeChunks(stripBOM(head, info), source, streamCodec(info).createDecoder()) };
}

/** Асинхронно только ради загрузки iconv-lite: байты читаются при итерации {@link IDecodedStream.text}. */
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

/** Куски читаются после загрузки iconv-lite — снимок должен быть уже снят. */
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
