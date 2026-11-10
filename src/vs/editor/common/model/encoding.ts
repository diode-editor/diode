import type IconvLiteModule from "iconv-lite";

import { importLazyModule } from "../../../base/common/lazyModule.ts";
import { startsWithUTF8BOM } from "../../../base/common/strings.ts";

import { BOM_UTF8, BOM_UTF16BE, BOM_UTF16LE, type IEncodingInfo, SUPPORTED_ENCODINGS } from "./supportedEncodings.ts";

export const DEFAULT_ENCODING = "utf8";
export const UTF8_WITH_BOM = "utf8bom";

const encodingsById = new Map(SUPPORTED_ENCODINGS.map((info) => [info.id, info]));

function requireEncodingInfo(id: string): IEncodingInfo {
    const info = encodingsById.get(id);
    /* v8 ignore start -- only called with table ids (explicit is checked by has(), sniffed/DEFAULT are table entries); the throw is an unreachable invariant guard */
    if (info === undefined) throw new Error(`No encoding info for id: ${id}`);
    /* v8 ignore stop */
    return info;
}

export function getEncodingInfo(id: string): IEncodingInfo | undefined {
    return encodingsById.get(id);
}

/**
 * A validated name ({@link validateEncoding}) outside the table ("cp1252") is its own label and iconv name: the
 * model keeps it verbatim, as upstream's `TextFileEditorModel` does.
 */
export function encodingInfoOf(encoding: string): IEncodingInfo {
    return encodingsById.get(encoding) ?? { id: encoding, label: encoding, statusLabel: encoding, iconvName: encoding };
}

function startsWithBytes(buffer: Uint8Array, bytes: readonly number[]): boolean {
    if (buffer.length < bytes.length) return false;
    for (let i = 0; i < bytes.length; i++) {
        if (buffer[i] !== bytes[i]) return false;
    }
    return true;
}

/** BOM only, no content guessing: the VS Code default. */
export function detectEncodingByBOM(buffer: Uint8Array): string | null {
    if (startsWithBytes(buffer, BOM_UTF8)) return UTF8_WITH_BOM;
    if (startsWithBytes(buffer, BOM_UTF16LE)) return "utf16le";
    if (startsWithBytes(buffer, BOM_UTF16BE)) return "utf16be";
    return null;
}

export interface IDecodedText {
    readonly text: string;
    /** Id from the {@link SUPPORTED_ENCODINGS} table, or a validated name outside it ("cp1252"). */
    readonly encoding: string;
}

export type IconvLite = typeof IconvLiteModule;

/**
 * A lazy chunk (docs/arch/Common.md): 540 KB that opening utf-8/UTF-16 never parses.
 * `default` is `module.exports` on any load path.
 */
export async function loadIconv(): Promise<IconvLite> {
    return (await importLazyModule("iconv-lite", () => import("iconv-lite"))).default;
}

/** Byte-identical to iconv-lite: it delegates these encodings to the same node primitives. */
interface INativeCodec {
    decode(body: Buffer): string;
    encode(text: string): Buffer;
}

const NATIVE_CODECS: ReadonlyMap<string, INativeCodec> = new Map<string, INativeCodec>([
    // Stryker disable next-line StringLiteral: Buffer.from with an empty encoding name is utf-8 too
    ["utf8", { decode: (body) => body.toString("utf8"), encode: (text) => Buffer.from(text, "utf8") }],
    ["utf16le", { decode: (body) => body.toString("utf16le"), encode: (text) => Buffer.from(text, "utf16le") }],
    [
        "utf16be",
        {
            // The copy keeps the caller's buffer intact; an odd trailing byte is dropped, as in iconv-lite.
            decode: (body) =>
                Buffer.from(body.subarray(0, body.length & ~1))
                    .swap16()
                    .toString("utf16le"),
            encode: (text) => Buffer.from(text, "utf16le").swap16(),
        },
    ],
]);

/** An explicit encoding beats the detected one, except "utf8" on content with a BOM: that stays "utf8bom". */
export function explicitOverDetected(explicit: string, detected: string | null): string {
    return explicit === DEFAULT_ENCODING && detected === UTF8_WITH_BOM ? UTF8_WITH_BOM : explicit;
}

/** `explicitEncoding` must be validated ({@link validateEncoding}); without it the BOM decides, otherwise utf-8. */
export function resolveDecodeEncoding(buffer: Buffer, explicitEncoding: string | undefined): IEncodingInfo {
    const sniffed = detectEncodingByBOM(buffer);
    if (explicitEncoding !== undefined) return encodingInfoOf(explicitOverDetected(explicitEncoding, sniffed));
    return requireEncodingInfo(sniffed ?? DEFAULT_ENCODING);
}

export function stripBOM(buffer: Buffer, info: IEncodingInfo): Buffer {
    return info.bom !== undefined && startsWithBytes(buffer, info.bom) ? buffer.subarray(info.bom.length) : buffer;
}

/** Synchronous and iconv-free: sniffing yields only utf-8 or UTF-16. */
export function decodeBufferByBOM(buffer: Buffer): IDecodedText {
    const info = resolveDecodeEncoding(buffer, undefined);
    const codec = NATIVE_CODECS.get(info.iconvName);
    /* v8 ignore start -- sniffing yields only utf8/utf8bom/utf16le/utf16be, all with a native codec; the throw is an invariant guard */
    // Stryker disable next-line all: unreachable invariant guard, see v8 ignore above
    if (codec === undefined) throw new Error(`No native codec for sniffed encoding: ${info.id}`);
    /* v8 ignore stop */
    return { text: codec.decode(stripBOM(buffer, info)), encoding: info.id };
}

/**
 * `explicitEncoding` beats sniffing, except "utf8" on a buffer with a BOM: that becomes
 * "utf8bom" so the BOM survives saving. A name iconv does not know is utf-8, as upstream.
 * Without an explicit encoding the synchronous {@link decodeBufferByBOM} gives the same result.
 */
export async function decodeBuffer(buffer: Buffer, explicitEncoding?: string): Promise<IDecodedText> {
    const explicit = explicitEncoding === undefined ? undefined : await validateEncoding(explicitEncoding);
    const { id } = resolveDecodeEncoding(buffer, explicit);
    return { text: await decodeWithEncoding(buffer, id), encoding: id };
}

/** A name iconv does not know becomes utf-8. */
export async function encodeText(text: string, encoding: string): Promise<Buffer> {
    return encodeWithEncoding(text, await validateEncoding(encoding));
}

/** iconv does not tell utf-8 with a BOM from one without (upstream `toNodeEncoding`). */
function toIconvName(encoding: string): string {
    return encoding === UTF8_WITH_BOM ? DEFAULT_ENCODING : encoding;
}

/**
 * Any name iconv-lite knows ("cp1252", "UTF-8"), not only the table's ids (upstream `encodingExists`).
 * The table's ids and the native names do not load iconv.
 */
export async function encodingExists(encoding: string): Promise<boolean> {
    const name = toIconvName(encoding);
    return encodingsById.has(encoding) || NATIVE_CODECS.has(name) || (await loadIconv()).encodingExists(name);
}

/** Upstream `getValidatedEncodingForResource`: a name iconv does not know becomes utf-8, not the setting. */
export async function validateEncoding(encoding: string): Promise<string> {
    return (await encodingExists(encoding)) ? encoding : DEFAULT_ENCODING;
}

/**
 * `encoding` must be validated ({@link validateEncoding}). A leading BOM is dropped for the Unicode
 * encodings only, as iconv-lite's `stripBOM` does: in windows1252 the same bytes are text.
 */
export async function decodeWithEncoding(buffer: Buffer, encoding: string): Promise<string> {
    const name = toIconvName(encoding);
    const codec = NATIVE_CODECS.get(name);
    if (codec === undefined) return (await loadIconv()).decode(buffer, name);
    const text = codec.decode(buffer);
    return startsWithUTF8BOM(text) ? text.slice(1) : text;
}

/**
 * `encoding` must be validated ({@link validateEncoding}). "utf8bom" and both UTF-16 write a BOM, as in
 * VS Code; unrepresentable chars become iconv-lite's "?".
 */
export async function encodeWithEncoding(text: string, encoding: string): Promise<Buffer> {
    const name = toIconvName(encoding);
    const codec = NATIVE_CODECS.get(name);
    const body = codec !== undefined ? codec.encode(text) : (await loadIconv()).encode(text, name);
    const bom = encodingsById.get(encoding)?.bom;
    return bom === undefined ? body : Buffer.concat([Buffer.from(bom), body]);
}
