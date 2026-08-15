import { describe, expect, it } from "vitest";

import { joinVirtualPath, packBundle, readBundleHeader, validateVirtualPath } from "./assetBundleFormat.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();

function bytesOf(text: string): Uint8Array {
    return enc.encode(text);
}

function readEntry(bundle: Uint8Array, virtualPath: string): Uint8Array {
    const { header, dataView } = readBundleHeader(bundle);
    const entry = header.files[virtualPath];
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (entry === undefined) throw new Error(`missing: ${virtualPath}`);
    return dataView.subarray(entry.offset, entry.offset + entry.size);
}

describe("AssetBundleFormat", () => {
    it("packs and reads a single entry roundtrip", () => {
        const bundle = packBundle([{ virtualPath: "onig.wasm", data: bytesOf("hello") }]);
        const data = readEntry(bundle, "onig.wasm");
        expect(dec.decode(data)).toBe("hello");
    });

    it("preserves multiple entries with correct offsets", () => {
        const bundle = packBundle([
            { virtualPath: "a.txt", data: bytesOf("alpha") },
            { virtualPath: "nested/b.json", data: bytesOf("{}") },
            { virtualPath: "c.bin", data: new Uint8Array([1, 2, 3, 4]) },
        ]);

        expect(dec.decode(readEntry(bundle, "a.txt"))).toBe("alpha");
        expect(dec.decode(readEntry(bundle, "nested/b.json"))).toBe("{}");
        expect(Array.from(readEntry(bundle, "c.bin"))).toEqual([1, 2, 3, 4]);
    });

    it("rejects bundles with bad magic", () => {
        const bundle = packBundle([{ virtualPath: "x", data: bytesOf("y") }]);
        bundle[0] = 0; // corrupt magic
        expect(() => readBundleHeader(bundle)).toThrow(/magic mismatch/);
    });

    it("rejects bundles smaller than magic+headerLen", () => {
        const bundle = packBundle([{ virtualPath: "x", data: bytesOf("y") }]);
        const truncated = bundle.subarray(0, 10); // < 8 magic + 4 headerLen
        expect(() => readBundleHeader(truncated)).toThrow(/too small/);
    });

    it("rejects bundles whose declared header length exceeds the buffer", () => {
        const bundle = packBundle([{ virtualPath: "x", data: bytesOf("y") }]);
        // Pass the magic + headerLen-size check, but cut off mid-header so
        // headerEnd > buffer.length (hits the "header length exceeds buffer" guard).
        const truncated = bundle.subarray(0, 14);
        expect(() => readBundleHeader(truncated)).toThrow(/truncated: header length exceeds buffer/);
    });

    it("rejects bundles with an unsupported version", () => {
        // packBundle всегда пишет version: 1, поэтому собираем буфер вручную:
        // [magic][headerLen LE][header JSON].
        const headerJson = enc.encode(JSON.stringify({ version: 2, files: {} }));
        const magic = new Uint8Array([0x44, 0x49, 0x4f, 0x44, 0x45, 0x42, 0x4e, 0x44]);
        const buf = new Uint8Array(magic.length + 4 + headerJson.length);
        buf.set(magic, 0);
        new DataView(buf.buffer).setUint32(magic.length, headerJson.length, /* littleEndian */ true);
        buf.set(headerJson, magic.length + 4);
        expect(() => readBundleHeader(buf)).toThrow(/Unsupported bundle version: 2/);
    });

    it("rejects duplicate paths", () => {
        expect(() =>
            packBundle([
                { virtualPath: "a", data: bytesOf("1") },
                { virtualPath: "a", data: bytesOf("2") },
            ]),
        ).toThrow(/Duplicate/);
    });

    it("validates virtual paths", () => {
        expect(() => {
            validateVirtualPath("");
        }).toThrow();
        expect(() => {
            validateVirtualPath("/abs");
        }).toThrow();
        expect(() => {
            validateVirtualPath("trail/");
        }).toThrow();
        expect(() => {
            validateVirtualPath("a/../b");
        }).toThrow();
        expect(() => {
            validateVirtualPath("a/./b");
        }).toThrow();
        expect(() => {
            validateVirtualPath("a//b");
        }).toThrow();
        expect(() => {
            validateVirtualPath("ok/path/file.json");
        }).not.toThrow();
    });

    it("joinVirtualPath склеивает по POSIX", () => {
        expect(joinVirtualPath("Extensions/builtin/ts", "syntaxes/ts.json")).toBe(
            "Extensions/builtin/ts/syntaxes/ts.json",
        );
        expect(joinVirtualPath("Extensions/builtin/ts/", "syntaxes/ts.json")).toBe(
            "Extensions/builtin/ts/syntaxes/ts.json",
        );
        expect(joinVirtualPath("Extensions/builtin/ts", "./syntaxes/ts.json")).toBe(
            "Extensions/builtin/ts/syntaxes/ts.json",
        );
        expect(joinVirtualPath("", "onig.wasm")).toBe("onig.wasm");
    });
});
