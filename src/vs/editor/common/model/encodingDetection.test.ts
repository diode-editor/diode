import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLazyModuleLoader } from "../../../base/common/lazyModule.ts";

import { detectEncoding, detectEncodingFromBuffer } from "./encodingDetection.ts";

const utf16le = (text: string): Buffer => Buffer.from(text, "utf16le");
const utf16be = (text: string): Buffer => Buffer.from(text, "utf16le").swap16();

/** "Hellö Wörld" in windows-1252. */
const CP1252 = Buffer.from([72, 101, 108, 108, 0xf6, 32, 87, 0xf6, 114, 108, 100]);
/** "Privet, kak dela? Vse horosho." in Cyrillic, windows-1251. */
const CP1251 = Buffer.from([
    0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x2c, 0x20, 0xea, 0xe0, 0xea, 0x20, 0xe4, 0xe5, 0xeb, 0xe0, 0x3f, 0x20, 0xc2,
    0xf1, 0xb8, 0x20, 0xf5, 0xee, 0xf0, 0xee, 0xf8, 0xee, 0x2e,
]);

describe("detectEncodingFromBuffer — the BOM, then zero bytes", () => {
    it("text without zeros: the BOM or nothing", () => {
        expect(detectEncodingFromBuffer(Buffer.from("Hello"))).toEqual({ encoding: null, seemsBinary: false });
        expect(detectEncodingFromBuffer(Buffer.from([0xef, 0xbb, 0xbf, 0x48]))).toEqual({
            encoding: "utf8bom",
            seemsBinary: false,
        });
        expect(detectEncodingFromBuffer(Buffer.alloc(0))).toEqual({ encoding: null, seemsBinary: false });
    });

    it("UTF-16 without a BOM: zeros at odd indexes are LE, at even ones BE", () => {
        expect(detectEncodingFromBuffer(utf16le("Hello"))).toEqual({ encoding: "utf16le", seemsBinary: false });
        expect(detectEncodingFromBuffer(utf16be("Hello"))).toEqual({ encoding: "utf16be", seemsBinary: false });
        // A single code unit: one zero is enough.
        expect(detectEncodingFromBuffer(Buffer.from([0x48, 0x00]))).toMatchObject({ encoding: "utf16le" });
        expect(detectEncodingFromBuffer(Buffer.from([0x00, 0x48]))).toMatchObject({ encoding: "utf16be" });
    });

    it("a UTF-16 BOM wins without a scan, even over zeros elsewhere", () => {
        expect(detectEncodingFromBuffer(Buffer.from([0xff, 0xfe, 0, 0, 0, 0]))).toEqual({
            encoding: "utf16le",
            seemsBinary: false,
        });
        expect(detectEncodingFromBuffer(Buffer.from([0xfe, 0xff, 0, 0, 0, 0]))).toEqual({
            encoding: "utf16be",
            seemsBinary: false,
        });
    });

    it("zeros in no UTF-16 pattern are binary; a UTF-8 BOM does not save it", () => {
        expect(detectEncodingFromBuffer(Buffer.from([0, 0, 0, 0]))).toEqual({ encoding: null, seemsBinary: true });
        expect(detectEncodingFromBuffer(Buffer.from([0x48, 0x00, 0x00, 0x00]))).toMatchObject({ seemsBinary: true });
        expect(detectEncodingFromBuffer(Buffer.from([0xef, 0xbb, 0xbf, 0x00, 0x00]))).toEqual({
            encoding: "utf8bom",
            seemsBinary: true,
        });
    });

    it("only the first 512 bytes are scanned", () => {
        const late = Buffer.concat([Buffer.from("a".repeat(512)), Buffer.from([0, 0, 0])]);
        expect(detectEncodingFromBuffer(late)).toEqual({ encoding: null, seemsBinary: false });
        const edge = Buffer.concat([Buffer.from("a".repeat(511)), Buffer.from([0, 0])]);
        expect(detectEncodingFromBuffer(edge)).toMatchObject({ seemsBinary: true });
    });

    it("UTF-16 stays UTF-16 across the whole scan, a late break in the pattern is binary", () => {
        expect(detectEncodingFromBuffer(utf16le("x".repeat(300)))).toMatchObject({ encoding: "utf16le" });
        const broken = Buffer.concat([utf16le("x".repeat(100)), Buffer.from([0, 0])]);
        expect(detectEncodingFromBuffer(broken)).toMatchObject({ seemsBinary: true });
    });
});

describe("detectEncoding — guessing with jschardet", () => {
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

    /** The chunk is replaced by a stub: the namespace of `import()` is not spyable. */
    function stubJschardet(detect: (input: Buffer, options?: unknown) => unknown) {
        const spy = vi.fn(detect);
        setLazyModuleLoader(<T>(id: string, importer: () => Promise<T>) =>
            id === "jschardet" ? Promise.resolve({ detect: spy } as T) : importer(),
        );
        return spy;
    }

    it("off: no guess and no jschardet", async () => {
        expect(await detectEncoding(CP1252, false, [])).toEqual({ encoding: null, seemsBinary: false });
        expect(requested).toEqual([]);
    });

    it("on: the iconv name of the guess (windows-1252 → windows1252) from a lazy chunk", async () => {
        expect(await detectEncoding(CP1252, true, [])).toEqual({ encoding: "windows1252", seemsBinary: false });
        expect(requested).toEqual(["jschardet"]);
    });

    it("on: no guess when the BOM or zeros already told, or the content is binary", async () => {
        expect(await detectEncoding(utf16le("Hello"), true, [])).toMatchObject({ encoding: "utf16le" });
        expect(await detectEncoding(Buffer.from([0, 0, 0, 0]), true, [])).toEqual({
            encoding: null,
            seemsBinary: true,
        });
        expect(requested).toEqual([]);
    });

    it("ascii is not a guess: utf-8 files would lose non-ASCII typing", async () => {
        expect(await detectEncoding(Buffer.from("Hello World"), true, [])).toEqual({
            encoding: null,
            seemsBinary: false,
        });
    });

    it("candidates narrow the guess; names are normalized, unguessable ones are dropped", async () => {
        const detect = stubJschardet(() => ({ encoding: "windows-1251", confidence: 1 }));
        await detectEncoding(CP1251, true, ["Windows-1251", "cp437", "nope", "koi8r"]);
        expect(detect).toHaveBeenLastCalledWith(expect.anything(), { detectEncodings: ["windows-1251", "KOI8-R"] });
        await detectEncoding(CP1251, true, ["cp437"]);
        expect(detect).toHaveBeenLastCalledWith(expect.anything(), undefined);
    });

    it("jschardet's names map to iconv's: IBM866 → cp866, Big5 → cp950", async () => {
        const detect = stubJschardet(() => ({ encoding: "", confidence: 0 }));
        detect.mockReturnValueOnce({ encoding: "IBM866", confidence: 1 });
        expect(await detectEncoding(CP1252, true, [])).toMatchObject({ encoding: "cp866" });
        detect.mockReturnValueOnce({ encoding: "Big5", confidence: 1 });
        expect(await detectEncoding(CP1252, true, [])).toMatchObject({ encoding: "cp950" });
        detect.mockReturnValueOnce({ encoding: "UTF-32", confidence: 1 });
        expect(await detectEncoding(CP1252, true, [])).toMatchObject({ encoding: null });
    });

    it("no answer or a throwing jschardet is no guess, not an error", async () => {
        const detect = stubJschardet(() => ({ encoding: "", confidence: 0 }));
        expect(await detectEncoding(CP1252, true, [])).toEqual({ encoding: null, seemsBinary: false });
        detect.mockImplementationOnce(() => {
            throw new Error("Encoding not supported");
        });
        expect(await detectEncoding(CP1252, true, [])).toEqual({ encoding: null, seemsBinary: false });
    });

    it("jschardet sees at most 64 KB", async () => {
        const detect = stubJschardet(() => ({ encoding: "ascii", confidence: 1 }));
        await detectEncoding(Buffer.alloc(100 * 1024, 0x61), true, []);
        expect(detect).toHaveBeenCalledWith(expect.objectContaining({ length: 64 * 1024 }), undefined);
    });
});
