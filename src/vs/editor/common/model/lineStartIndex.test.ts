import { describe, expect, it } from "vitest";

import { LineStartIndex } from "./lineStartIndex.ts";

/** Every `\n` position + 1, plus the first start — what a one-shot scan of the whole text gives. */
function expectedStarts(text: string, first: number): number[] {
    const starts = [first];
    for (let at = text.indexOf("\n", first); at !== -1; at = text.indexOf("\n", at + 1)) starts.push(at + 1);
    return starts;
}

function indexInChunks(text: string, chunkSize: number, first = 0): LineStartIndex {
    const bytes = Buffer.from(text, "latin1");
    const index = new LineStartIndex();
    index.append(first);
    for (let offset = first; offset < bytes.length; offset += chunkSize) {
        index.appendChunk(bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)), offset);
    }
    return index;
}

function allStarts(index: LineStartIndex): number[] {
    return Array.from({ length: index.count }, (_, line) => index.lineStart(line));
}

describe("LineStartIndex", () => {
    const SAMPLES = ["", "\n", "a", "a\n", "\n\n\n", "ab\ncd\nef", "ab\r\ncd\r\n", "one\n\ntwo\nthree\n\n"];

    for (const sample of SAMPLES) {
        it(`${JSON.stringify(sample)}: any chunking gives the one-shot starts`, () => {
            for (let chunkSize = 1; chunkSize <= sample.length + 1; chunkSize++) {
                expect(allStarts(indexInChunks(sample, chunkSize)), `chunk ${String(chunkSize)}`).toEqual(
                    expectedStarts(sample, 0),
                );
            }
        });
    }

    it("the first start may be past a BOM; chunks start after it too", () => {
        const text = "\xef\xbb\xbfa\nb\nc";
        expect(allStarts(indexInChunks(text, 2, 3))).toEqual(expectedStarts(text, 3));
    });

    it("appendChunk returns the number of starts it recorded and records nothing for a chunk without a feed", () => {
        const index = new LineStartIndex();
        index.append(0);
        expect(index.appendChunk(Buffer.from("abc"), 0)).toBe(0);
        expect(index.count).toBe(1);
        expect(index.appendChunk(Buffer.from("d\ne\n"), 3)).toBe(2);
        expect(index.count).toBe(3);
        expect(allStarts(index)).toEqual([0, 5, 7]);
    });

    it("blocks keep offsets relative to their base: a start past 2^32 is exact", () => {
        const index = new LineStartIndex();
        index.append(0);
        const base = 2 ** 33 + 5;
        index.appendChunk(Buffer.from("x\ny\n"), base);
        expect(allStarts(index)).toEqual([0, base + 2, base + 4]);
    });

    it("lookups outside the recorded starts throw", () => {
        const index = new LineStartIndex();
        expect(() => index.lineStart(0)).toThrow("Line 0 is not indexed (0 line starts)");
        index.append(0);
        expect(index.lineStart(0)).toBe(0);
        expect(() => index.lineStart(1)).toThrow(RangeError);
        expect(() => index.lineStart(-1)).toThrow(/not indexed/);
    });

    it("a plain Uint8Array chunk is scanned like a Buffer", () => {
        const index = new LineStartIndex();
        index.append(0);
        expect(index.appendChunk(new Uint8Array([0x61, 0x0a, 0x62, 0x0a]), 0)).toBe(2);
        expect(allStarts(index)).toEqual([0, 2, 4]);
    });

    it("many small blocks: the binary search over blocks finds every line", () => {
        const lines = 1000;
        const text = Array.from({ length: lines }, (_, i) => String(i)).join("\n") + "\n";
        for (const chunkSize of [1, 7, 64, 4096]) {
            expect(allStarts(indexInChunks(text, chunkSize))).toEqual(expectedStarts(text, 0));
        }
    });
});
