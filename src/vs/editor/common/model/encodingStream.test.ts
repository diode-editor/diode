import { afterEach, describe, expect, it } from "vitest";

import { setLazyModuleLoader } from "../../../base/common/lazyModule.ts";

import { decodeBuffer, encodeText } from "./encoding.ts";
import {
    createStreamDecoder,
    decodeStream,
    decodeStreamByBOM,
    encodeChunks,
    ENCODED_CHUNK_SIZE,
    encodeStream,
} from "./encodingStream.ts";

function splits(bytes: Buffer): Buffer[][] {
    const result: Buffer[][] = [[bytes], [...bytes].map((b) => Buffer.from([b]))];
    for (let at = 0; at <= bytes.length; at++) result.push([bytes.subarray(0, at), bytes.subarray(at)]);
    return result;
}

function textSplits(text: string): string[][] {
    const result: string[][] = [[text], [...text.split("")]];
    for (let at = 0; at <= text.length; at++) result.push([text.slice(0, at), text.slice(at)]);
    return result;
}

const SAMPLES = [
    "",
    "a",
    "line\r\nnext\r\n",
    "\u043f\u0440\u0438\u0432\u0435\u0442\r\n\u043c\u0438\u0440", // "privet\r\nmir"
    "😀 \u0438 𝄞\n", // "😀 i 𝄞\n"
    "\ufeff\u0432\u043d\u0443\u0442\u0440\u0435\u043d\u043d\u0438\u0439 BOM", // "\ufeffvnutrenniy BOM"
    // Two-byte utf-8 character with the smallest valid lead byte C2.
    "© 2026",
    // Three-byte with the smallest lead byte E0 (U+0800–U+0FFF).
    "नमस्ते",
    // Lone surrogates: utf-8 yields EF BF BD, UTF-16 keeps the code unit as is.
    "x\ud83dy",
    "\udc00z\ud83d",
];

const IDS = ["utf8", "utf8bom", "utf16le", "utf16be", "windows1251", "gb18030", "shiftjis"];

describe("decodeStream / decodeStreamByBOM", () => {
    for (const id of IDS) {
        it(`${id}: any byte split == one-shot decode`, async () => {
            for (const sample of SAMPLES) {
                const bytes = await encodeText(sample, id);
                const whole = await decodeBuffer(bytes, id);
                for (const chunks of splits(bytes)) {
                    const streamed = await decodeStream(chunks, id);
                    const label = `${id} ${JSON.stringify(sample)} ${chunks.map((c) => c.toString("hex")).join("|")}`;
                    expect(streamed.encoding, label).toBe(whole.encoding);
                    expect([...streamed.text].join(""), label).toBe(whole.text);
                }
            }
        });
    }

    it("chunked BOM sniffing: a BOM split by a boundary is still recognized and stripped", () => {
        const bytes = Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0xd0, 0xbf]);
        for (const chunks of splits(bytes)) {
            const decoded = decodeStreamByBOM(chunks);
            expect(decoded.encoding).toBe("utf8bom");
            expect([...decoded.text].join("")).toBe("a\u043f"); // "ap"
        }
        const utf16 = decodeStreamByBOM([Buffer.from([0xfe]), Buffer.from([0xff, 0x04]), Buffer.from([0x3f])]);
        expect(utf16.encoding).toBe("utf16be");
        expect([...utf16.text].join("")).toBe("\u043f"); // "p"
    });

    it("an incomplete utf-8 sequence at end of file — U+FFFD, like the one-shot decode", () => {
        for (const tail of [[0xd0], [0xe2, 0x82], [0xf0, 0x9f, 0x98]]) {
            const bytes = Buffer.from([0x61, ...tail]);
            const expected = bytes.toString("utf8");
            for (const chunks of splits(bytes)) {
                expect([...decodeStreamByBOM(chunks).text].join("")).toBe(expected);
            }
        }
    });

    it("an odd trailing UTF-16 byte is dropped when reading in chunks too", () => {
        const decoded = decodeStreamByBOM([Buffer.from([0xff, 0xfe, 0x3f]), Buffer.from([0x04, 0x41])]);
        expect([...decoded.text].join("")).toBe("\u043f"); // "p"
    });

    it("bytes are pulled as iteration proceeds, an abandoned iteration closes the source", () => {
        const pulled: number[] = [];
        let closed = false;
        function* source(): Generator<Buffer> {
            try {
                for (let i = 0; i < 4; i++) {
                    pulled.push(i);
                    yield Buffer.from(`chunk${String(i)}`);
                }
            } finally {
                closed = true;
            }
        }
        const decoded = decodeStreamByBOM(source());
        expect(pulled).toEqual([0]);
        // Exactly three bytes already suffice for the longest BOM; the second chunk isn't needed.
        pulled.length = 0;
        function* short(): Generator<Buffer> {
            for (let i = 0; i < 2; i++) {
                pulled.push(i);
                yield Buffer.from("abc");
            }
        }
        decodeStreamByBOM(short());
        expect(pulled).toEqual([0]);
        for (const text of decoded.text) {
            if (text === "chunk1") break;
        }
        expect(pulled).toEqual([0, 1]);
        expect(closed).toBe(true);
    });
});

describe("createStreamDecoder", () => {
    it("utf-8 fed byte by byte across a multibyte character == one-shot decoding", () => {
        const bytes = Buffer.from("a😀β", "utf8");
        const decoder = createStreamDecoder("utf8bom");
        const parts = [...bytes].map((byte) => decoder.write(Buffer.from([byte])));
        parts.push(decoder.end());
        expect(parts.join("")).toBe("a😀β");
    });

    it("UTF-16 is native too; a non-Unicode encoding has no streaming codec", () => {
        const decoder = createStreamDecoder("utf16le");
        expect(decoder.write(Buffer.from("hi", "utf16le")) + decoder.end()).toBe("hi");
        expect(() => createStreamDecoder("windows1251")).toThrow(/No native codec/);
    });
});

describe("encodeStream", () => {
    async function pieces(chunks: string[], encoding: string): Promise<Buffer[]> {
        const result: Buffer[] = [];
        for await (const piece of encodeStream(chunks, encoding)) result.push(piece);
        return result;
    }

    it("yields about a megabyte at a time, the BOM first; the joined pieces are the one-shot encoding", async () => {
        const chunk = "x".repeat(64 * 1024);
        const chunks = Array.from({ length: 40 }, () => chunk);
        const result = await pieces(chunks, "utf8bom");
        // 2.5 MiB of text plus the BOM: two full pieces and the rest.
        expect(result.map((piece) => piece.length)).toEqual([ENCODED_CHUNK_SIZE + 3, ENCODED_CHUNK_SIZE, 512 * 1024]);
        expect(Buffer.concat(result).equals(await encodeText(chunks.join(""), "utf8bom"))).toBe(true);
    });

    it("reads the snapshot only as the pieces are taken", async () => {
        let read = 0;
        function* snapshot(): Generator<string> {
            for (let i = 0; i < 3; i++) {
                read++;
                yield "y".repeat(ENCODED_CHUNK_SIZE);
            }
        }
        const stream = encodeStream(snapshot(), "utf8");
        expect(read).toBe(0);
        await stream.next();
        expect(read).toBe(1);
    });

    it("a non-Unicode encoding still encodes, at once", async () => {
        const result = await pieces(["caf", "\u00e9"], "windows1252");
        expect(Buffer.concat(result).equals(await encodeText("caf\u00e9", "windows1252"))).toBe(true);
    });
});

describe("encodeChunks", () => {
    for (const id of IDS) {
        it(`${id}: any text split (including mid surrogate pair) == one-shot encoding`, async () => {
            for (const sample of SAMPLES) {
                const whole = await encodeText(sample, id);
                for (const chunks of textSplits(sample)) {
                    const label = `${id} ${JSON.stringify(chunks)}`;
                    expect((await encodeChunks(chunks, id)).toString("hex"), label).toBe(whole.toString("hex"));
                }
            }
        });
    }

    it("a pair split by a boundary — one 4-byte utf-8 character, not two U+FFFD", async () => {
        expect((await encodeChunks(["a\ud83d", "\ude00"], "utf8")).toString("hex")).toBe("61f09f9880");
    });

    it("the extreme high surrogates D800 and DBFF at a boundary also wait for the pair", async () => {
        expect((await encodeChunks(["\ud800", "\udc00"], "utf8")).toString("hex")).toBe("f0908080");
        expect((await encodeChunks(["\udbff", "\udfff"], "utf8")).toString("hex")).toBe("f48fbfbf");
    });

    it("BOM is written even for an empty snapshot", async () => {
        expect([...(await encodeChunks([], "utf16le"))]).toEqual([0xff, 0xfe]);
    });

    it("unknown encoding — utf-8 without BOM, like encodeText", async () => {
        expect(
            (await encodeChunks(["\u043f\u0440\u0438", "\u0432\u0435\u0442"], "martian")).equals(
                Buffer.from("\u043f\u0440\u0438\u0432\u0435\u0442", "utf8"),
            ),
        ).toBe(true); // "pri", "vet", "privet"
    });
});

describe("iconv-lite load failure", () => {
    afterEach(() => {
        setLazyModuleLoader(undefined);
    });

    it("decodeStream fails and closes an already started source", async () => {
        setLazyModuleLoader(() => Promise.reject(new Error("lazy chunk failed to load")));
        let closed = false;
        function* source(): Generator<Buffer> {
            try {
                yield Buffer.from([0xcf, 0xf0]);
                yield Buffer.from([0xe8]);
            } finally {
                closed = true;
            }
        }
        await expect(decodeStream(source(), "windows1251")).rejects.toThrow("lazy chunk failed to load");
        expect(closed).toBe(true);
    });

    it("decodeStream fails even for a source without return (array iterator)", async () => {
        setLazyModuleLoader(() => Promise.reject(new Error("lazy chunk failed to load")));
        await expect(decodeStream([Buffer.from([0xcf])], "windows1251")).rejects.toThrow("lazy chunk failed to load");
    });

    it("encodeChunks fails instead of silently writing utf-8", async () => {
        setLazyModuleLoader(() => Promise.reject(new Error("lazy chunk failed to load")));
        await expect(encodeChunks(["\u041f"], "koi8r")).rejects.toThrow("lazy chunk failed to load"); // "P"
    });
});
