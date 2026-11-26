import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setLazyModuleLoader } from "../../../base/common/lazyModule.ts";

import { decodeWithEncoding, encodeWithEncoding, encodingExists, validateEncoding } from "./encoding.ts";

/** "Hellö Wörld" in windows-1252. */
const CP1252 = Buffer.from([72, 101, 108, 108, 0xf6, 32, 87, 0xf6, 114, 108, 100]);

describe("encoding names beyond the table (any name iconv-lite knows)", () => {
    it("encodingExists: table ids, iconv aliases and spellings, utf8bom; not a made-up name", async () => {
        for (const name of ["utf8", "utf8bom", "utf16le", "windows1252", "cp1252", "UTF-8", "ISO-8859-1"]) {
            expect(await encodingExists(name), name).toBe(true);
        }
        expect(await encodingExists("foobar123")).toBe(false);
    });

    it("validateEncoding keeps a known name verbatim and turns an unknown one into utf8", async () => {
        expect(await validateEncoding("cp1252")).toBe("cp1252");
        expect(await validateEncoding("utf8bom")).toBe("utf8bom");
        expect(await validateEncoding("foobar123")).toBe("utf8");
    });

    it("decodeWithEncoding decodes by an alias and drops a BOM only in a Unicode encoding", async () => {
        expect(await decodeWithEncoding(CP1252, "cp1252")).toBe("Hellö Wörld");
        const withBOM = Buffer.from([0xef, 0xbb, 0xbf, 0x48, 0x69]);
        expect(await decodeWithEncoding(withBOM, "utf8")).toBe("Hi");
        expect(await decodeWithEncoding(withBOM, "utf8bom")).toBe("Hi");
        expect(await decodeWithEncoding(withBOM, "UTF-8")).toBe("Hi");
        expect(await decodeWithEncoding(withBOM, "windows1252")).toBe("ï»¿Hi");
        expect(await decodeWithEncoding(Buffer.from([0xff, 0xfe, 0x48, 0x00]), "utf16le")).toBe("H");
        expect(await decodeWithEncoding(Buffer.from([0xfe, 0xff, 0x00, 0x48]), "utf16be")).toBe("H");
        // A U+FEFF further on is text.
        expect(await decodeWithEncoding(Buffer.from("a﻿"), "utf8")).toBe("a﻿");
    });

    it("encodeWithEncoding writes a BOM for utf8bom and both UTF-16 only, not for their aliases", async () => {
        expect([...(await encodeWithEncoding("Hi", "utf8bom"))]).toEqual([0xef, 0xbb, 0xbf, 0x48, 0x69]);
        expect([...(await encodeWithEncoding("H", "utf16le"))]).toEqual([0xff, 0xfe, 0x48, 0x00]);
        expect([...(await encodeWithEncoding("H", "utf16be"))]).toEqual([0xfe, 0xff, 0x00, 0x48]);
        expect([...(await encodeWithEncoding("Hi", "UTF-8"))]).toEqual([0x48, 0x69]);
        expect(await encodeWithEncoding("Hellö Wörld", "cp1252")).toEqual(CP1252);
    });
});

describe("encoding names — iconv-lite stays a lazy chunk", () => {
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

    it("utf-8 and UTF-16 under their own ids do not load iconv-lite", async () => {
        for (const name of ["utf8", "utf8bom", "utf16le", "utf16be"]) {
            await encodingExists(name);
            await decodeWithEncoding(await encodeWithEncoding("x", name), name);
        }
        expect(requested).toEqual([]);
        await encodingExists("cp1252");
        expect(requested).toEqual(["iconv-lite"]);
    });
});
