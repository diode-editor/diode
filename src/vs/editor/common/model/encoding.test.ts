import iconv from "iconv-lite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLazyModuleLoader } from "../../../base/common/lazyModule.ts";

import {
    decodeBuffer,
    decodeBufferByBOM,
    DEFAULT_ENCODING,
    detectEncodingByBOM,
    encodeText,
    getEncodingInfo,
    SUPPORTED_ENCODINGS,
} from "./encoding.ts";

describe("SUPPORTED_ENCODINGS", () => {
    it("every iconvName exists in iconv-lite", () => {
        for (const info of SUPPORTED_ENCODINGS) {
            expect(iconv.encodingExists(info.iconvName), `iconv-lite lacks "${info.iconvName}" (${info.id})`).toBe(
                true,
            );
        }
    });

    it("ids are unique", () => {
        const ids = SUPPORTED_ENCODINGS.map((info) => info.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("getEncodingInfo resolves known ids and rejects unknown ones", () => {
        expect(getEncodingInfo("windows1251")?.label).toBe("Cyrillic (Windows 1251)");
        expect(getEncodingInfo("nope")).toBeUndefined();
    });

    it("default encoding is part of the table", () => {
        expect(getEncodingInfo(DEFAULT_ENCODING)).toBeDefined();
    });
});

describe("detectEncodingByBOM", () => {
    it("detects the UTF-8 BOM", () => {
        expect(detectEncodingByBOM(Buffer.from([0xef, 0xbb, 0xbf, 0x61]))).toBe("utf8bom");
    });

    it("detects the UTF-16 LE BOM", () => {
        expect(detectEncodingByBOM(Buffer.from([0xff, 0xfe, 0x61, 0x00]))).toBe("utf16le");
    });

    it("detects the UTF-16 BE BOM", () => {
        expect(detectEncodingByBOM(Buffer.from([0xfe, 0xff, 0x00, 0x61]))).toBe("utf16be");
    });

    it("returns null without a BOM", () => {
        expect(detectEncodingByBOM(Buffer.from("plain ascii"))).toBeNull();
        expect(detectEncodingByBOM(Buffer.alloc(0))).toBeNull();
    });

    it("does not misread a partial BOM prefix", () => {
        expect(detectEncodingByBOM(Buffer.from([0xef, 0xbb]))).toBeNull();
        expect(detectEncodingByBOM(Buffer.from([0xff]))).toBeNull();
    });
});

describe("decodeBuffer", () => {
    it("defaults to utf8 without a BOM", async () => {
        const { text, encoding } = await decodeBuffer(Buffer.from("\u043f\u0440\u0438\u0432\u0435\u0442", "utf8")); // "privet"
        expect(text).toBe("\u043f\u0440\u0438\u0432\u0435\u0442"); // "privet"
        expect(encoding).toBe("utf8");
    });

    it("strips the BOM from utf8bom text", async () => {
        const buffer = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("hi", "utf8")]);
        const { text, encoding } = await decodeBuffer(buffer);
        expect(text).toBe("hi");
        expect(encoding).toBe("utf8bom");
    });

    it("decodes utf16le and utf16be by BOM", async () => {
        const le = await decodeBuffer(Buffer.concat([Buffer.from([0xff, 0xfe]), iconv.encode("\u0430\u0431\u0432", "utf16le")])); // "abv"
        expect(le).toEqual({ text: "\u0430\u0431\u0432", encoding: "utf16le" }); // "abv"

        const be = await decodeBuffer(Buffer.concat([Buffer.from([0xfe, 0xff]), iconv.encode("\u0430\u0431\u0432", "utf16-be")])); // "abv"
        expect(be).toEqual({ text: "\u0430\u0431\u0432", encoding: "utf16be" }); // "abv"
    });

    it("an explicit encoding wins over the utf8 default", async () => {
        const bytes = iconv.encode("\u043f\u0440\u0438\u0432\u0435\u0442", "windows1251"); // "privet"
        const { text, encoding } = await decodeBuffer(bytes, "windows1251");
        expect(text).toBe("\u043f\u0440\u0438\u0432\u0435\u0442"); // "privet"
        expect(encoding).toBe("windows1251");
    });

    it("promotes explicit utf8 to utf8bom when the buffer carries a UTF-8 BOM", async () => {
        const buffer = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("x", "utf8")]);
        const { text, encoding } = await decodeBuffer(buffer, "utf8");
        expect(text).toBe("x");
        expect(encoding).toBe("utf8bom");
    });

    it("explicit non-utf8 encoding suppresses BOM re-detection", async () => {
        const bytes = iconv.encode("ïâ", "windows1251");
        const { encoding } = await decodeBuffer(bytes, "windows1251");
        expect(encoding).toBe("windows1251");
    });

    it("only explicit utf8 is promoted by a UTF-8 BOM; windows1251 reads those bytes as text", async () => {
        const buffer = Buffer.from([0xef, 0xbb, 0xbf, 0x41]);
        const decoded = await decodeBuffer(buffer, "windows1251");
        expect(decoded).toEqual({ text: iconv.decode(buffer, "windows1251"), encoding: "windows1251" });
        expect(decoded.text).toHaveLength(4);
    });

    it("explicit utf8bom on a BOM-less buffer does not eat leading bytes", async () => {
        const { text, encoding } = await decodeBuffer(Buffer.from("abc", "utf8"), "utf8bom");
        expect(text).toBe("abc");
        expect(encoding).toBe("utf8bom");
    });

    it("unknown explicit id falls back to sniff-or-default", async () => {
        const { encoding } = await decodeBuffer(Buffer.from("abc"), "martian");
        expect(encoding).toBe("utf8");
    });
});

describe("decodeBufferByBOM", () => {
    it("is the synchronous no-explicit-encoding decodeBuffer", () => {
        expect(decodeBufferByBOM(Buffer.from("\u043f\u0440\u0438\u0432\u0435\u0442", "utf8"))).toEqual({ text: "\u043f\u0440\u0438\u0432\u0435\u0442", encoding: "utf8" }); // "privet"
        const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("hi", "utf8")]);
        expect(decodeBufferByBOM(bom)).toEqual({ text: "hi", encoding: "utf8bom" });
        const be = Buffer.concat([Buffer.from([0xfe, 0xff]), iconv.encode("\u0430\u0431\u0432", "utf16-be")]); // "abv"
        expect(decodeBufferByBOM(be)).toEqual({ text: "\u0430\u0431\u0432", encoding: "utf16be" }); // "abv"
    });

    it("leaves the caller's buffer intact (utf16be swaps a copy)", () => {
        const be = Buffer.concat([Buffer.from([0xfe, 0xff]), iconv.encode("ab", "utf16-be")]);
        const before = [...be];
        decodeBufferByBOM(be);
        expect([...be]).toEqual(before);
    });
});

describe("encodeText", () => {
    it("utf8 writes no BOM", async () => {
        expect([...(await encodeText("hi", "utf8"))]).toEqual([...Buffer.from("hi", "utf8")]);
    });

    it("utf8bom always writes the BOM", async () => {
        expect([...(await encodeText("hi", "utf8bom")).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    });

    it("utf16le/utf16be always write their BOM", async () => {
        expect([...(await encodeText("a", "utf16le")).subarray(0, 2)]).toEqual([0xff, 0xfe]);
        expect([...(await encodeText("a", "utf16be")).subarray(0, 2)]).toEqual([0xfe, 0xff]);
    });

    it("unknown id falls back to utf8", async () => {
        expect([...(await encodeText("hi", "martian"))]).toEqual([...Buffer.from("hi", "utf8")]);
    });

    it("unencodable characters degrade to the replacement character", async () => {
        const bytes = await encodeText("日本語", "windows1251");
        expect(iconv.decode(bytes, "windows1251")).toBe("???");
    });
});

describe("roundtrips (byte-exact)", () => {
    const samples: [string, string][] = [
        ["utf8", "line one\n\u0441\u0442\u0440\u043e\u043a\u0430 \u0434\u0432\u0430\n"], // "line one\nstroka dva\n"
        ["utf8bom", "with bom\n\u043a\u0438\u0440\u0438\u043b\u043b\u0438\u0446\u0430\n"], // "with bom\nkirillitsa\n"
        ["utf16le", "utf16 le\n\u0442\u0435\u043a\u0441\u0442\n"], // "utf16 le\ntekst\n"
        ["utf16be", "utf16 be\n\u0442\u0435\u043a\u0441\u0442\n"], // "utf16 be\ntekst\n"
        ["windows1251", "\u041f\u0440\u0438\u0432\u0435\u0442, \u043c\u0438\u0440!\n\u0401\u0436\u0438\u043a — №5\n"], // "Privet, mir!\nYozhik — №5\n"
        ["koi8r", "\u041a\u0438\u0440\u0438\u043b\u043b\u0438\u0446\u0430 \u041a\u041e\u0418-8\n"], // "Kirillitsa KOI-8\n"
    ];

    for (const [encoding, text] of samples) {
        it(`${encoding}: decode(encode(text)) preserves text and bytes`, async () => {
            const bytes = await encodeText(text, encoding);
            const decoded = await decodeBuffer(bytes);
            // BOM-less single-byte encodings sniff back to utf8 — force the id.
            const decodedExplicit = await decodeBuffer(bytes, encoding);
            expect(decodedExplicit.text).toBe(text);
            expect(decodedExplicit.encoding).toBe(encoding);
            if (encoding === "utf8bom" || encoding === "utf16le" || encoding === "utf16be") {
                expect(decoded.encoding).toBe(encoding);
                expect(decoded.text).toBe(text);
            }
            expect([...(await encodeText(decodedExplicit.text, decodedExplicit.encoding))]).toEqual([...bytes]);
        });
    }
});

// The result is the same (tests below) — the only difference is whether iconv was called.
describe("utf-8 and UTF-16 do not go through iconv-lite", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("decode/encode of Unicode encodings and BOM sniffing do not call iconv, windows-1251 does", async () => {
        const decode = vi.spyOn(iconv, "decode");
        const encode = vi.spyOn(iconv, "encode");
        for (const id of ["utf8", "utf8bom", "utf16le", "utf16be"]) {
            const bytes = await encodeText("\u043f\u0440\u0438\u0432\u0435\u0442", id); // "privet"
            await decodeBuffer(bytes, id);
            decodeBufferByBOM(bytes);
        }
        expect(encode).not.toHaveBeenCalled();
        expect(decode).not.toHaveBeenCalled();

        await decodeBuffer(await encodeText("\u043f\u0440\u0438\u0432\u0435\u0442", "windows1251"), "windows1251"); // "privet"
        expect(encode).toHaveBeenCalledTimes(1);
        expect(decode).toHaveBeenCalledTimes(1);
    });
});

describe("iconv-lite — lazy chunk", () => {
    let requested: string[] = [];

    beforeEach(() => {
        requested = [];
        setLazyModuleLoader(<T>(id: string, importer: () => Promise<T>) => {
            requested.push(id);
            return importer();
        });
    });

    afterEach(() => {
        setLazyModuleLoader(undefined);
    });

    it("utf-8 and UTF-16 both ways, BOM sniffing and the utf-8 fallback — without iconv", async () => {
        for (const id of ["utf8", "utf8bom", "utf16le", "utf16be", "martian"]) {
            const bytes = await encodeText("\u043f\u0440\u0438\u0432\u0435\u0442", id); // "privet"
            await decodeBuffer(bytes, id);
            decodeBufferByBOM(bytes);
        }
        await decodeBuffer(Buffer.from("abc"));
        expect(requested).toEqual([]);
    });

    it("other encodings request the iconv-lite chunk", async () => {
        const bytes = await encodeText("\u043f\u0440\u0438\u0432\u0435\u0442", "windows1251"); // "privet"
        expect(requested).toEqual(["iconv-lite"]);
        expect(await decodeBuffer(bytes, "windows1251")).toEqual({ text: "\u043f\u0440\u0438\u0432\u0435\u0442", encoding: "windows1251" }); // "privet"
        expect(requested).toEqual(["iconv-lite", "iconv-lite"]);
    });

    it("a chunk load failure fails decode and write, not a silent utf-8", async () => {
        setLazyModuleLoader(() => Promise.reject(new Error("lazy chunk failed to load")));
        await expect(decodeBuffer(Buffer.from([0xcf]), "windows1251")).rejects.toThrow("lazy chunk failed to load");
        await expect(encodeText("\u041f", "koi8r")).rejects.toThrow("lazy chunk failed to load"); // "P"
    });
});

// The reference for comparison is the previous implementation: strip the BOM ourselves, decode the body via iconv-lite.

describe("native codecs == iconv-lite", () => {
    const UNICODE_IDS = ["utf8", "utf8bom", "utf16le", "utf16be"];

    function iconvDecode(buffer: Buffer, id: string): string {
        const info = getEncodingInfo(id);
        if (info === undefined) throw new Error(id);
        const bom = info.bom ?? [];
        const hasBom = bom.length > 0 && buffer.length >= bom.length && bom.every((b, i) => buffer[i] === b);
        return iconv.decode(hasBom ? buffer.subarray(bom.length) : buffer, info.iconvName, { stripBOM: false });
    }

    function iconvEncode(text: string, id: string): Buffer {
        const info = getEncodingInfo(id);
        if (info === undefined) throw new Error(id);
        const body = iconv.encode(text, info.iconvName, { addBOM: false });
        return Buffer.concat([Buffer.from(info.bom ?? []), body]);
    }

    /** The reference decodes in the encoding the result reported: utf8 with a BOM is promoted to utf8bom. */
    async function expectDecodeMatchesIconv(buffer: Buffer): Promise<void> {
        const label = buffer.toString("hex");
        for (const id of UNICODE_IDS) {
            const decoded = await decodeBuffer(buffer, id);
            expect(decoded.text, `${id} ${label}`).toBe(iconvDecode(buffer, decoded.encoding));
        }
        const sniffed = decodeBufferByBOM(buffer);
        expect(sniffed.text, `sniff ${label}`).toBe(iconvDecode(buffer, sniffed.encoding));
    }

    const bytes = (...b: number[]): Buffer => Buffer.from(b);
    const decodeCases: [string, Buffer][] = [
        ["empty", Buffer.alloc(0)],
        ["ascii", Buffer.from("plain text\r\n")],
        ["cyrillic", Buffer.from("\u043f\u0440\u0438\u0432\u0435\u0442", "utf8")], // "privet"
        ["astral (4-byte)", bytes(0xf0, 0x9f, 0x98, 0x80)],
        ["UTF-8 BOM only", bytes(0xef, 0xbb, 0xbf)],
        ["double UTF-8 BOM", bytes(0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x61)],
        ["UTF-16 LE BOM only", bytes(0xff, 0xfe)],
        ["UTF-16 BE BOM only", bytes(0xfe, 0xff)],
        ["lone continuation byte", bytes(0x61, 0x80, 0x62)],
        ["0xff", bytes(0xff)],
        ["cut 2-byte sequence", bytes(0x61, 0xc3)],
        ["cut 3-byte sequence", bytes(0xe2, 0x82)],
        ["cut 4-byte sequence", bytes(0xf0, 0x9f, 0x98)],
        ["cut sequence mid-buffer", bytes(0xe2, 0x82, 0x61)],
        ["overlong NUL", bytes(0xc0, 0x80)],
        ["UTF-8-encoded surrogate", bytes(0xed, 0xa0, 0x80)],
        ["above U+10FFFF", bytes(0xf4, 0x90, 0x80, 0x80)],
        ["odd UTF-16 length", bytes(0x61, 0x00, 0x62)],
        ["lone high surrogate LE", bytes(0x3d, 0xd8)],
        ["lone low surrogate LE", bytes(0x00, 0xde, 0x61, 0x00)],
        ["reversed surrogate pair LE", bytes(0x00, 0xde, 0x3d, 0xd8)],
        ["surrogate pair cut by odd tail", bytes(0x3d, 0xd8, 0x00)],
        ["NUL bytes", bytes(0x00, 0x00, 0x00)],
    ];

    for (const [name, buffer] of decodeCases) {
        it(`decode: ${name}`, async () => {
            await expectDecodeMatchesIconv(buffer);
        });
    }

    const encodeCases: [string, string][] = [
        ["empty", ""],
        ["ascii", "plain text\r\n"],
        ["cyrillic", "\u043f\u0440\u0438\u0432\u0435\u0442"], // "privet"
        ["astral", "😀"],
        ["leading U+FEFF", "﻿x"],
        ["lone high surrogate", "a\ud83d"],
        ["lone low surrogate", "\ude00b"],
        ["reversed surrogate pair", "\ude00\ud83d"],
        ["NUL", "a\u0000b"],
        ["noncharacter", "￿￾"],
    ];

    for (const [name, text] of encodeCases) {
        it(`encode: ${name}`, async () => {
            for (const id of UNICODE_IDS) {
                expect([...(await encodeText(text, id))], id).toEqual([...iconvEncode(text, id)]);
            }
        });
    }

    it("seeded fuzz: random bytes and strings", async () => {
        // Skewed towards high and surrogate bytes — that's where codecs diverge.
        let seed = 0x1c0f;
        const random = (): number => {
            seed = (seed + 0x6d2b79f5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        const pick = (n: number): number => Math.floor(random() * n);
        const BYTE_POOL = [
            0x00, 0x61, 0x7f, 0x80, 0xbf, 0xc0, 0xc3, 0xd8, 0xdc, 0xdf, 0xe2, 0xed, 0xef, 0xf0, 0xf4, 0xfe, 0xff,
        ];
        const UNIT_POOL = [0x61, 0x44f, 0xd83d, 0xde00, 0xdbff, 0xdc00, 0xfeff, 0xfffd, 0xffff];
        for (let round = 0; round < 3000; round++) {
            const buffer = Buffer.from(
                Array.from({ length: pick(10) }, () => (pick(3) === 0 ? pick(256) : BYTE_POOL[pick(BYTE_POOL.length)])),
            );
            const text = String.fromCharCode(
                ...Array.from({ length: pick(6) }, () => UNIT_POOL[pick(UNIT_POOL.length)]),
            );
            await expectDecodeMatchesIconv(buffer);
            for (const id of UNICODE_IDS) {
                expect([...(await encodeText(text, id))], `${id} ${JSON.stringify(text)}`).toEqual([
                    ...iconvEncode(text, id),
                ]);
            }
        }
    });
});
