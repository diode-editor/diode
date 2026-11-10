import type * as JschardetModule from "jschardet";

import { importLazyModule } from "../../../base/common/lazyModule.ts";

import { detectEncodingByBOM, getEncodingInfo } from "./encoding.ts";

/**
 * Upstream `detectEncodingFromBuffer` (`services/textfile/common/encoding.ts`). A module of its own: only
 * `workspace.decode` detects by zero bytes and guesses so far, and outside `main.cjs` it does not count
 * against the budget of the code the extension host shares with the core (`roles/extension-host`).
 */

/** Upstream `ZERO_BYTE_DETECTION_BUFFER_MAX_LEN`. */
const ZERO_BYTE_DETECTION_MAX_BYTES = 512;
/** Upstream `AUTO_ENCODING_GUESS_MAX_BYTES`: jschardet slows down badly on large input. */
const AUTO_ENCODING_GUESS_MAX_BYTES = 512 * 128;

export interface IDetectedEncoding {
    readonly encoding: string | null;
    readonly seemsBinary: boolean;
}

/**
 * Upstream `detectEncodingFromBuffer` without guessing: the BOM first, then zero bytes in the first
 * 512 bytes. Zeros only at odd indexes are UTF-16 LE, only at even ones UTF-16 BE, anything else is binary.
 */
export function detectEncodingFromBuffer(buffer: Uint8Array): IDetectedEncoding {
    const byBOM = detectEncodingByBOM(buffer);
    if (byBOM === "utf16le" || byBOM === "utf16be") return { encoding: byBOM, seemsBinary: false };
    let couldBeUTF16LE = true;
    let couldBeUTF16BE = true;
    let containsZeroByte = false;
    const end = Math.min(buffer.length, ZERO_BYTE_DETECTION_MAX_BYTES);
    for (let i = 0; i < end; i++) {
        const isOdd = i % 2 === 1;
        const isZero = buffer[i] === 0;
        containsZeroByte ||= isZero;
        // UTF-16 LE: 0xAA 0x00; UTF-16 BE: 0x00 0xAA.
        couldBeUTF16LE &&= isOdd === isZero;
        couldBeUTF16BE &&= isOdd !== isZero;
        if (isZero && !couldBeUTF16LE && !couldBeUTF16BE) break;
    }
    if (!containsZeroByte) return { encoding: byBOM, seemsBinary: false };
    if (couldBeUTF16LE) return { encoding: "utf16le", seemsBinary: false };
    if (couldBeUTF16BE) return { encoding: "utf16be", seemsBinary: false };
    return { encoding: byBOM, seemsBinary: true };
}

/** Upstream `detectEncodingFromBuffer` with `autoGuessEncoding`: guessing only when nothing else told. */
export async function detectEncoding(
    buffer: Buffer,
    autoGuessEncoding: boolean,
    candidateGuessEncodings: readonly string[],
): Promise<IDetectedEncoding> {
    const detected = detectEncodingFromBuffer(buffer);
    if (!autoGuessEncoding || detected.seemsBinary || detected.encoding !== null) return detected;
    return { encoding: await guessEncodingByBuffer(buffer, candidateGuessEncodings), seemsBinary: false };
}

/** A lazy chunk (docs/arch/Common.md): only `files.autoGuessEncoding` needs it. */
function loadJschardet(): Promise<typeof JschardetModule> {
    return importLazyModule("jschardet", () => import("jschardet"));
}

/** ASCII would make most utf-8 files single-byte; UTF-16 has its own detection; UTF-32 is not supported. */
const IGNORED_GUESSES = new Set(["ascii", "utf-16", "utf-32"]);

const JSCHARDET_TO_ICONV: ReadonlyMap<string, string> = new Map([
    ["ibm866", "cp866"],
    ["big5", "cp950"],
]);

function normalizeEncodingName(name: string): string {
    return name.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

/** Upstream `guessEncodingByBuffer`: the result is an iconv name ("windows1252"), not jschardet's. */
async function guessEncodingByBuffer(
    buffer: Buffer,
    candidateGuessEncodings: readonly string[],
): Promise<string | null> {
    const jschardet = await loadJschardet();
    const detectEncodings = candidateGuessEncodings.flatMap((name) => {
        const guessable = getEncodingInfo(normalizeEncodingName(name))?.guessableName;
        return guessable === undefined ? [] : [guessable];
    });
    let guessed: string | undefined;
    try {
        guessed = jschardet.detect(
            buffer.subarray(0, AUTO_ENCODING_GUESS_MAX_BYTES),
            detectEncodings.length > 0 ? { detectEncodings } : undefined,
        ).encoding;
    } catch {
        // jschardet throws on some input (microsoft/vscode#239928).
        return null;
    }
    if (!guessed || IGNORED_GUESSES.has(guessed.toLowerCase())) return null;
    const normalized = normalizeEncodingName(guessed);
    return JSCHARDET_TO_ICONV.get(normalized) ?? normalized;
}
