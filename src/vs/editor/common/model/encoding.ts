import iconv from "iconv-lite";

/**
 * Charset axis of a document: the byte representation used at the disk
 * boundary. Sibling of the EOL axis (EndOfLine.ts) — documents internally
 * always store JS strings; the encoding only matters when reading raw bytes
 * from disk and when serializing back.
 *
 * Encodings are addressed by VS Code's canonical string ids ('utf8',
 * 'utf8bom', 'windows1251', …) — the exact values the `vscode` extension API
 * exposes via `TextDocument.encoding`, so the extension bridge needs no
 * mapping.
 */
export interface IEncodingInfo {
    /** VS Code canonical id, e.g. "windows1251". */
    readonly id: string;
    /** Full picker label, e.g. "Cyrillic (Windows 1251)". */
    readonly label: string;
    /** Short status bar form, e.g. "Windows 1251". */
    readonly statusLabel: string;
    /** iconv-lite codec name; differs from id only for "utf8bom". */
    readonly iconvName: string;
    /** BOM bytes written on encode (and recognized on decode). */
    readonly bom?: readonly number[];
}

export const DEFAULT_ENCODING = "utf8";

const BOM_UTF8 = [0xef, 0xbb, 0xbf] as const;
const BOM_UTF16LE = [0xff, 0xfe] as const;
const BOM_UTF16BE = [0xfe, 0xff] as const;

/**
 * The encodings offered in the picker, in VS Code's SUPPORTED_ENCODINGS order
 * (Unicode variants first, then grouped by script). Every entry's `iconvName`
 * is covered by a test asserting `iconv.encodingExists`.
 */
export const SUPPORTED_ENCODINGS: readonly IEncodingInfo[] = [
    { id: "utf8", label: "UTF-8", statusLabel: "UTF-8", iconvName: "utf8" },
    { id: "utf8bom", label: "UTF-8 with BOM", statusLabel: "UTF-8 with BOM", iconvName: "utf8", bom: BOM_UTF8 },
    { id: "utf16le", label: "UTF-16 LE", statusLabel: "UTF-16 LE", iconvName: "utf16le", bom: BOM_UTF16LE },
    { id: "utf16be", label: "UTF-16 BE", statusLabel: "UTF-16 BE", iconvName: "utf16be", bom: BOM_UTF16BE },
    { id: "windows1252", label: "Western (Windows 1252)", statusLabel: "Windows 1252", iconvName: "windows1252" },
    { id: "iso88591", label: "Western (ISO 8859-1)", statusLabel: "ISO 8859-1", iconvName: "iso88591" },
    { id: "iso88593", label: "Western (ISO 8859-3)", statusLabel: "ISO 8859-3", iconvName: "iso88593" },
    { id: "iso885915", label: "Western (ISO 8859-15)", statusLabel: "ISO 8859-15", iconvName: "iso885915" },
    { id: "macroman", label: "Western (Mac Roman)", statusLabel: "Mac Roman", iconvName: "macroman" },
    { id: "cp437", label: "DOS (CP 437)", statusLabel: "CP437", iconvName: "cp437" },
    { id: "windows1256", label: "Arabic (Windows 1256)", statusLabel: "Windows 1256", iconvName: "windows1256" },
    { id: "iso88596", label: "Arabic (ISO 8859-6)", statusLabel: "ISO 8859-6", iconvName: "iso88596" },
    { id: "windows1257", label: "Baltic (Windows 1257)", statusLabel: "Windows 1257", iconvName: "windows1257" },
    { id: "iso88594", label: "Baltic (ISO 8859-4)", statusLabel: "ISO 8859-4", iconvName: "iso88594" },
    { id: "iso885914", label: "Celtic (ISO 8859-14)", statusLabel: "ISO 8859-14", iconvName: "iso885914" },
    {
        id: "windows1250",
        label: "Central European (Windows 1250)",
        statusLabel: "Windows 1250",
        iconvName: "windows1250",
    },
    { id: "iso88592", label: "Central European (ISO 8859-2)", statusLabel: "ISO 8859-2", iconvName: "iso88592" },
    { id: "cp852", label: "Central European (CP 852)", statusLabel: "CP 852", iconvName: "cp852" },
    { id: "windows1251", label: "Cyrillic (Windows 1251)", statusLabel: "Windows 1251", iconvName: "windows1251" },
    { id: "cp866", label: "Cyrillic (CP 866)", statusLabel: "CP 866", iconvName: "cp866" },
    { id: "cp1125", label: "Cyrillic (CP 1125)", statusLabel: "CP 1125", iconvName: "cp1125" },
    { id: "iso88595", label: "Cyrillic (ISO 8859-5)", statusLabel: "ISO 8859-5", iconvName: "iso88595" },
    { id: "koi8r", label: "Cyrillic (KOI8-R)", statusLabel: "KOI8-R", iconvName: "koi8r" },
    { id: "koi8u", label: "Cyrillic (KOI8-U)", statusLabel: "KOI8-U", iconvName: "koi8u" },
    { id: "koi8ru", label: "Cyrillic (KOI8-RU)", statusLabel: "KOI8-RU", iconvName: "koi8ru" },
    { id: "koi8t", label: "Tajik (KOI8-T)", statusLabel: "KOI8-T", iconvName: "koi8t" },
    { id: "iso885913", label: "Estonian (ISO 8859-13)", statusLabel: "ISO 8859-13", iconvName: "iso885913" },
    { id: "windows1253", label: "Greek (Windows 1253)", statusLabel: "Windows 1253", iconvName: "windows1253" },
    { id: "iso88597", label: "Greek (ISO 8859-7)", statusLabel: "ISO 8859-7", iconvName: "iso88597" },
    { id: "windows1255", label: "Hebrew (Windows 1255)", statusLabel: "Windows 1255", iconvName: "windows1255" },
    { id: "iso88598", label: "Hebrew (ISO 8859-8)", statusLabel: "ISO 8859-8", iconvName: "iso88598" },
    { id: "iso885910", label: "Nordic (ISO 8859-10)", statusLabel: "ISO 8859-10", iconvName: "iso885910" },
    { id: "cp865", label: "Nordic DOS (CP 865)", statusLabel: "CP 865", iconvName: "cp865" },
    { id: "iso885916", label: "Romanian (ISO 8859-16)", statusLabel: "ISO 8859-16", iconvName: "iso885916" },
    { id: "windows1254", label: "Turkish (Windows 1254)", statusLabel: "Windows 1254", iconvName: "windows1254" },
    { id: "iso88599", label: "Turkish (ISO 8859-9)", statusLabel: "ISO 8859-9", iconvName: "iso88599" },
    { id: "cp857", label: "Turkish DOS (CP 857)", statusLabel: "CP 857", iconvName: "cp857" },
    { id: "windows1258", label: "Vietnamese (Windows 1258)", statusLabel: "Windows 1258", iconvName: "windows1258" },
    { id: "windows874", label: "Thai (Windows 874)", statusLabel: "Windows 874", iconvName: "windows874" },
    { id: "iso885911", label: "Latin/Thai (ISO 8859-11)", statusLabel: "ISO 8859-11", iconvName: "iso885911" },
    { id: "cp850", label: "Western European DOS (CP 850)", statusLabel: "CP 850", iconvName: "cp850" },
    { id: "gb2312", label: "Simplified Chinese (GB 2312)", statusLabel: "GB 2312", iconvName: "gb2312" },
    { id: "gbk", label: "Simplified Chinese (GBK)", statusLabel: "GBK", iconvName: "gbk" },
    { id: "gb18030", label: "Simplified Chinese (GB 18030)", statusLabel: "GB 18030", iconvName: "gb18030" },
    { id: "cp950", label: "Traditional Chinese (Big5)", statusLabel: "Big5", iconvName: "cp950" },
    {
        id: "big5hkscs",
        label: "Traditional Chinese (Big5-HKSCS)",
        statusLabel: "Big5-HKSCS",
        iconvName: "big5hkscs",
    },
    { id: "shiftjis", label: "Japanese (Shift JIS)", statusLabel: "Shift JIS", iconvName: "shiftjis" },
    { id: "eucjp", label: "Japanese (EUC-JP)", statusLabel: "EUC-JP", iconvName: "eucjp" },
    { id: "euckr", label: "Korean (EUC-KR)", statusLabel: "EUC-KR", iconvName: "euckr" },
];

const encodingsById = new Map(SUPPORTED_ENCODINGS.map((info) => [info.id, info]));

function requireEncodingInfo(id: string): IEncodingInfo {
    const info = encodingsById.get(id);
    /* v8 ignore start -- вызывается только с табличными id (explicit проверен has(), сниф/DEFAULT — элементы таблицы); throw — недостижимый инвариант-гард */
    if (info === undefined) throw new Error(`No encoding info for id: ${id}`);
    /* v8 ignore stop */
    return info;
}

/** Resolves an encoding id to its table entry, or undefined for unknown ids. */
export function getEncodingInfo(id: string): IEncodingInfo | undefined {
    return encodingsById.get(id);
}

function startsWithBytes(buffer: Buffer, bytes: readonly number[]): boolean {
    if (buffer.length < bytes.length) return false;
    for (let i = 0; i < bytes.length; i++) {
        if (buffer[i] !== bytes[i]) return false;
    }
    return true;
}

/**
 * BOM-only encoding sniff (VS Code default behavior — no content guessing):
 * recognizes the UTF-8, UTF-16 LE and UTF-16 BE byte order marks, or null
 * when the buffer starts with none of them.
 */
export function detectEncodingByBOM(buffer: Buffer): string | null {
    if (startsWithBytes(buffer, BOM_UTF8)) return "utf8bom";
    if (startsWithBytes(buffer, BOM_UTF16LE)) return "utf16le";
    if (startsWithBytes(buffer, BOM_UTF16BE)) return "utf16be";
    return null;
}

/** Document text decoded from disk bytes plus the encoding id it was read in. */
export interface IDecodedText {
    readonly text: string;
    /** Table id ({@link SUPPORTED_ENCODINGS}), never an iconv name. */
    readonly encoding: string;
}

type IconvLite = typeof iconv;

/** iconv-lite for the charsets the native codecs do not cover. */
function loadIconv(): Promise<IconvLite> {
    return Promise.resolve(iconv);
}

/**
 * Codec over node's own `Buffer`, no iconv-lite. Byte-for-byte the same as
 * iconv-lite for these charsets — iconv-lite delegates them to the very same
 * node primitives (StringDecoder, `Buffer.from`): invalid utf-8 → U+FFFD, a
 * lone surrogate → EF BF BD on utf-8 encode and the code unit as is on UTF-16,
 * an odd trailing UTF-16 byte dropped. Pinned by the "native == iconv-lite" tests.
 */
interface INativeCodec {
    decode(body: Buffer): string;
    encode(text: string): Buffer;
}

/** Native codecs by iconv name: utf-8 (both table ids) and the two UTF-16s. */
const NATIVE_CODECS: ReadonlyMap<string, INativeCodec> = new Map<string, INativeCodec>([
    // Stryker disable next-line StringLiteral: Buffer.from с пустым именем кодировки — тоже utf-8
    ["utf8", { decode: (body) => body.toString("utf8"), encode: (text) => Buffer.from(text, "utf8") }],
    ["utf16le", { decode: (body) => body.toString("utf16le"), encode: (text) => Buffer.from(text, "utf16le") }],
    [
        "utf16be",
        {
            // В node нет UTF-16 BE: меняем байты пар местами и читаем как LE. Копия
            // не портит буфер вызывающего; нечётный хвостовой байт отбрасывается,
            // как у iconv-lite.
            decode: (body) =>
                Buffer.from(body.subarray(0, body.length & ~1))
                    .swap16()
                    .toString("utf16le"),
            encode: (text) => Buffer.from(text, "utf16le").swap16(),
        },
    ],
]);

/** The table entry `buffer` is decoded in (rules — {@link decodeBuffer}). */
function resolveDecodeEncoding(buffer: Buffer, explicitEncoding: string | undefined): IEncodingInfo {
    const sniffed = detectEncodingByBOM(buffer);
    // По построению id всегда табличный: explicit проверен через has(),
    // значения снифа и DEFAULT_ENCODING — элементы таблицы.
    // Stryker disable next-line ConditionalExpression: has(undefined) и так false — проверка нужна типам, не поведению
    if (explicitEncoding !== undefined && encodingsById.has(explicitEncoding)) {
        return requireEncodingInfo(explicitEncoding === "utf8" && sniffed === "utf8bom" ? "utf8bom" : explicitEncoding);
    }
    return requireEncodingInfo(sniffed ?? DEFAULT_ENCODING);
}

/** `buffer` without the encoding's BOM, when it starts with one. */
function stripBOM(buffer: Buffer, info: IEncodingInfo): Buffer {
    return info.bom !== undefined && startsWithBytes(buffer, info.bom) ? buffer.subarray(info.bom.length) : buffer;
}

/**
 * Decodes raw disk bytes by the BOM sniff alone — opening a file, no explicit
 * encoding. Synchronous and iconv-free: the sniff only ever yields utf-8 (with
 * or without BOM) or UTF-16, all decoded natively. The BOM is stripped.
 */
export function decodeBufferByBOM(buffer: Buffer): IDecodedText {
    const info = resolveDecodeEncoding(buffer, undefined);
    const codec = NATIVE_CODECS.get(info.iconvName);
    /* v8 ignore start -- сниф даёт только utf8/utf8bom/utf16le/utf16be, у всех есть нативный кодек; throw — инвариант-гард */
    // Stryker disable next-line all: недостижимый инвариант-гард, см. v8 ignore выше
    if (codec === undefined) throw new Error(`No native codec for sniffed encoding: ${info.id}`);
    /* v8 ignore stop */
    return { text: codec.decode(stripBOM(buffer, info)), encoding: info.id };
}

/**
 * Decodes raw disk bytes to document text.
 *
 * `explicitEncoding` (e.g. from "Reopen with Encoding") wins over the BOM
 * sniff, with one exception: explicit "utf8" on a buffer that carries a UTF-8
 * BOM is promoted to "utf8bom" so the BOM survives a later save. Unknown
 * explicit ids fall back to the sniff-or-default path. The BOM bytes are
 * stripped before decoding and never appear in the returned text.
 *
 * Asynchronous because charsets beyond utf-8 and UTF-16 need iconv-lite;
 * those two are decoded natively. Without an explicit encoding prefer the
 * synchronous {@link decodeBufferByBOM} — same result.
 */
export async function decodeBuffer(buffer: Buffer, explicitEncoding?: string): Promise<IDecodedText> {
    const info = resolveDecodeEncoding(buffer, explicitEncoding);
    const body = stripBOM(buffer, info);
    const codec = NATIVE_CODECS.get(info.iconvName);
    // Опции BOM iconv-lite не передаём: у не-Unicode кодеков они пустые (BOM
    // понимают только utf-8/UTF-16/UTF-32, а те идут нативно), BOM снят выше.
    const text = codec !== undefined ? codec.decode(body) : (await loadIconv()).decode(body, info.iconvName);
    return { text, encoding: info.id };
}

/**
 * Encodes document text to the bytes written to disk. BOM policy matches
 * VS Code: "utf8bom" and both UTF-16 variants always write their BOM, every
 * other encoding writes none. Unknown ids defensively fall back to utf-8.
 * Characters unrepresentable in the target charset become iconv-lite's
 * replacement ("?"). Asynchronous for the same reason as {@link decodeBuffer}.
 */
export async function encodeText(text: string, encoding: string): Promise<Buffer> {
    const info = encodingsById.get(encoding) ?? requireEncodingInfo(DEFAULT_ENCODING);
    const codec = NATIVE_CODECS.get(info.iconvName);
    // addBOM, как и stripBOM в decodeBuffer, у не-Unicode кодеков пустой.
    const body = codec !== undefined ? codec.encode(text) : (await loadIconv()).encode(text, info.iconvName);
    if (info.bom === undefined) return body;
    return Buffer.concat([Buffer.from(info.bom), body]);
}
