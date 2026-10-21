import { describe, expect, it } from "vitest";

import { packBundle } from "./assetBundleFormat.ts";
import { BundleAssetAccess } from "./bundleAssetAccess.ts";

const enc = new TextEncoder();

function makeBundle() {
    return packBundle([
        { virtualPath: "onig.wasm", data: new Uint8Array([0xaa, 0xbb, 0xcc]) },
        { virtualPath: "Extensions/builtin/ts/package.json", data: enc.encode('{"name":"ts"}') },
        { virtualPath: "Extensions/builtin/ts/syntaxes/ts.tmLanguage.json", data: enc.encode("{}") },
        { virtualPath: "Extensions/builtin/css/package.json", data: enc.encode('{"name":"css"}') },
    ]);
}

describe("BundleAssetAccess", () => {
    it("читает entries по виртуальному пути", async () => {
        const access = new BundleAssetAccess(makeBundle());
        expect(Array.from(await access.read("onig.wasm"))).toEqual([0xaa, 0xbb, 0xcc]);
        expect(await access.readText("Extensions/builtin/ts/package.json")).toBe('{"name":"ts"}');
    });

    it("exists() корректно отвечает", async () => {
        const access = new BundleAssetAccess(makeBundle());
        expect(await access.exists("onig.wasm")).toBe(true);
        expect(await access.exists("Extensions/builtin/ts/package.json")).toBe(true);
        expect(await access.exists("missing.bin")).toBe(false);
    });

    it("listEntries по корню возвращает верхний уровень", async () => {
        const access = new BundleAssetAccess(makeBundle());
        const top = (await access.listEntries("")).map((e) => `${e.name}${e.isDirectory ? "/" : ""}`).sort();
        expect(top).toEqual(["Extensions/", "onig.wasm"]);
    });

    it("listEntries по префиксу возвращает дочерние записи", async () => {
        const access = new BundleAssetAccess(makeBundle());
        const exts = (await access.listEntries("Extensions/builtin/"))
            .map((e) => ({ name: e.name, isDirectory: e.isDirectory }))
            .sort((a, b) => a.name.localeCompare(b.name));
        expect(exts).toEqual([
            { name: "css", isDirectory: true },
            { name: "ts", isDirectory: true },
        ]);

        const tsContents = (await access.listEntries("Extensions/builtin/ts/"))
            .map((e) => ({ name: e.name, isDirectory: e.isDirectory }))
            .sort((a, b) => a.name.localeCompare(b.name));
        expect(tsContents).toEqual([
            { name: "package.json", isDirectory: false },
            { name: "syntaxes", isDirectory: true },
        ]);
    });

    it("read бросает на отсутствующий путь", async () => {
        const access = new BundleAssetAccess(makeBundle());
        await expect(access.read("missing.bin")).rejects.toThrow(/not found/);
    });

    it("listEntries по неизвестному префиксу возвращает []", async () => {
        const access = new BundleAssetAccess(makeBundle());
        expect(await access.listEntries("Nonexistent/")).toEqual([]);
    });

    it("listEntries без trailing / бросает", async () => {
        const access = new BundleAssetAccess(makeBundle());
        await expect(access.listEntries("Extensions/builtin")).rejects.toThrow();
    });

    it("exists() возвращает false для невалидного виртуального пути", async () => {
        const access = new BundleAssetAccess(makeBundle());
        expect(await access.exists("/abs/path")).toBe(false);
        expect(await access.exists("")).toBe(false);
    });

    it("бросает при конфликте имени (файл и каталог одновременно)", () => {
        // "a" is both a file and the directory segment of "a/b" → index conflict.
        const conflicting = packBundle([
            { virtualPath: "a", data: enc.encode("file") },
            { virtualPath: "a/b", data: enc.encode("under-dir") },
        ]);
        expect(() => new BundleAssetAccess(conflicting)).toThrow(/path conflict/);
    });
});
