import { afterEach, describe, expect, it } from "vitest";

import { setLazyModuleLoader } from "../../../base/common/lazyModule.ts";

import { decodeBuffer, encodeText } from "./encoding.ts";
import { decodeStream, decodeStreamByBOM, encodeChunks } from "./encodingStream.ts";

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
    "привет\r\nмир",
    "😀 и 𝄞\n",
    "\ufeffвнутренний BOM",
    // Двухбайтовый символ utf-8 с наименьшим допустимым ведущим байтом C2.
    "© 2026",
    // Трёхбайтовый с наименьшим ведущим байтом E0 (U+0800–U+0FFF).
    "नमस्ते",
    // Одинокие суррогаты: utf-8 даёт EF BF BD, UTF-16 — кодовую единицу как есть.
    "x\ud83dy",
    "\udc00z\ud83d",
];

const IDS = ["utf8", "utf8bom", "utf16le", "utf16be", "windows1251", "gb18030", "shiftjis"];

describe("decodeStream / decodeStreamByBOM", () => {
    for (const id of IDS) {
        it(`${id}: любой разрез байт == разовому декоду`, async () => {
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

    it("сниф BOM по кускам: BOM, разрезанный границей, всё равно узнан и снят", () => {
        const bytes = Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0xd0, 0xbf]);
        for (const chunks of splits(bytes)) {
            const decoded = decodeStreamByBOM(chunks);
            expect(decoded.encoding).toBe("utf8bom");
            expect([...decoded.text].join("")).toBe("aп");
        }
        const utf16 = decodeStreamByBOM([Buffer.from([0xfe]), Buffer.from([0xff, 0x04]), Buffer.from([0x3f])]);
        expect(utf16.encoding).toBe("utf16be");
        expect([...utf16.text].join("")).toBe("п");
    });

    it("недописанная последовательность utf-8 в конце файла — U+FFFD, как у разового декода", () => {
        for (const tail of [[0xd0], [0xe2, 0x82], [0xf0, 0x9f, 0x98]]) {
            const bytes = Buffer.from([0x61, ...tail]);
            const expected = bytes.toString("utf8");
            for (const chunks of splits(bytes)) {
                expect([...decodeStreamByBOM(chunks).text].join("")).toBe(expected);
            }
        }
    });

    it("нечётный хвостовой байт UTF-16 отбрасывается и при чтении по кускам", () => {
        const decoded = decodeStreamByBOM([Buffer.from([0xff, 0xfe, 0x3f]), Buffer.from([0x04, 0x41])]);
        expect([...decoded.text].join("")).toBe("п");
    });

    it("байты читаются по мере прохода, брошенный проход закрывает источник", () => {
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
        // Ровно три байта — уже хватает на самый длинный BOM, второй кусок не нужен.
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

describe("encodeChunks", () => {
    for (const id of IDS) {
        it(`${id}: любой разрез текста (и посреди суррогатной пары) == разовому кодированию`, async () => {
            for (const sample of SAMPLES) {
                const whole = await encodeText(sample, id);
                for (const chunks of textSplits(sample)) {
                    const label = `${id} ${JSON.stringify(chunks)}`;
                    expect((await encodeChunks(chunks, id)).toString("hex"), label).toBe(whole.toString("hex"));
                }
            }
        });
    }

    it("пара, разрезанная границей, — один 4-байтовый символ utf-8, а не два U+FFFD", async () => {
        expect((await encodeChunks(["a\ud83d", "\ude00"], "utf8")).toString("hex")).toBe("61f09f9880");
    });

    it("крайние старшие суррогаты D800 и DBFF на границе тоже ждут пару", async () => {
        expect((await encodeChunks(["\ud800", "\udc00"], "utf8")).toString("hex")).toBe("f0908080");
        expect((await encodeChunks(["\udbff", "\udfff"], "utf8")).toString("hex")).toBe("f48fbfbf");
    });

    it("BOM пишется и для пустого снапшота", async () => {
        expect([...(await encodeChunks([], "utf16le"))]).toEqual([0xff, 0xfe]);
    });

    it("неизвестная кодировка — utf-8 без BOM, как у encodeText", async () => {
        expect((await encodeChunks(["при", "вет"], "martian")).equals(Buffer.from("привет", "utf8"))).toBe(true);
    });
});

describe("отказ загрузки iconv-lite", () => {
    afterEach(() => {
        setLazyModuleLoader(undefined);
    });

    it("decodeStream отказывает и закрывает уже начатый источник", async () => {
        setLazyModuleLoader(() => Promise.reject(new Error("кусок не загрузился")));
        let closed = false;
        function* source(): Generator<Buffer> {
            try {
                yield Buffer.from([0xcf, 0xf0]);
                yield Buffer.from([0xe8]);
            } finally {
                closed = true;
            }
        }
        await expect(decodeStream(source(), "windows1251")).rejects.toThrow("кусок не загрузился");
        expect(closed).toBe(true);
    });

    it("decodeStream отказывает и у источника без return (итератор массива)", async () => {
        setLazyModuleLoader(() => Promise.reject(new Error("кусок не загрузился")));
        await expect(decodeStream([Buffer.from([0xcf])], "windows1251")).rejects.toThrow("кусок не загрузился");
    });

    it("encodeChunks отказывает, а не пишет молча utf-8", async () => {
        setLazyModuleLoader(() => Promise.reject(new Error("кусок не загрузился")));
        await expect(encodeChunks(["П"], "koi8r")).rejects.toThrow("кусок не загрузился");
    });
});
