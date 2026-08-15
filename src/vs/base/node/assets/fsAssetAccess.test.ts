import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";

import { FsAssetAccess } from "./fsAssetAccess.ts";

describe("FsAssetAccess", () => {
    let ws: ITempWorkspace;
    let root: string;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-fs-asset-",
            files: {
                "ext/ts/package.json": '{"name":"ts"}',
                "ext/ts/syntaxes/ts.tmLanguage.json": "{}",
            },
        });
        root = ws.dir;
        writeFileSync(join(root, "onig.wasm"), Buffer.from([1, 2, 3]));
    });

    afterEach(() => {
        ws.dispose();
    });

    it("читает текстовые ассеты по prefix-mapping", async () => {
        const assets = new FsAssetAccess({ "Extensions/builtin/": join(root, "ext") });
        expect(await assets.readText("Extensions/builtin/ts/package.json")).toBe('{"name":"ts"}');
    });

    it("читает бинарные ассеты по exact-mapping", async () => {
        const assets = new FsAssetAccess({ "onig.wasm": join(root, "onig.wasm") });
        expect(Array.from(await assets.read("onig.wasm"))).toEqual([1, 2, 3]);
    });

    it("exists() возвращает true/false", async () => {
        const assets = new FsAssetAccess({ "Extensions/builtin/": join(root, "ext") });
        expect(await assets.exists("Extensions/builtin/ts/package.json")).toBe(true);
        expect(await assets.exists("Extensions/builtin/ts/missing.json")).toBe(false);
    });

    it("listEntries возвращает дочерние записи каталога", async () => {
        const assets = new FsAssetAccess({ "Extensions/builtin/": join(root, "ext") });
        const entries = (await assets.listEntries("Extensions/builtin/")).sort((a, b) => a.name.localeCompare(b.name));
        expect(entries).toEqual([{ name: "ts", isDirectory: true }]);

        const tsEntries = (await assets.listEntries("Extensions/builtin/ts/")).map((e) => e.name).sort();
        expect(tsEntries).toEqual(["package.json", "syntaxes"]);
    });

    it("бросает на путь без mapping", async () => {
        const assets = new FsAssetAccess({ "Extensions/builtin/": join(root, "ext") });
        await expect(assets.read("unmapped.bin")).rejects.toThrow(/No FS mapping/);
    });

    it("validate-ит виртуальные пути (`..` запрещены)", async () => {
        const assets = new FsAssetAccess({ "Extensions/builtin/": join(root, "ext") });
        await expect(assets.read("Extensions/../escape")).rejects.toThrow();
    });

    it("listEntries без trailing / бросает", async () => {
        const assets = new FsAssetAccess({ "Extensions/builtin/": join(root, "ext") });
        await expect(assets.listEntries("Extensions/builtin")).rejects.toThrow(/must end with/);
    });

    it("listEntries возвращает [] для несуществующего каталога", async () => {
        const assets = new FsAssetAccess({ "Extensions/builtin/": join(root, "ext") });
        expect(await assets.listEntries("Extensions/builtin/nope/")).toEqual([]);
    });

    it('listEntries по пустому prefix бросает, если нет mapping для ""', async () => {
        const assets = new FsAssetAccess({ "Extensions/builtin/": join(root, "ext") });
        await expect(assets.listEntries("")).rejects.toThrow(/empty virtual prefix/);
    });

    it('listEntries по пустому prefix читает root, если он замаплен на ""', async () => {
        const assets = new FsAssetAccess({ "": join(root, "ext") });
        const entries = (await assets.listEntries("")).map((e) => e.name).sort();
        expect(entries).toEqual(["ts"]);
    });

    it("read пропускает не совпавший exact-mapping и берёт следующий", async () => {
        // Длинный exact-префикс сортируется первым, но не совпадает с путём →
        // resolveToFs должен его пропустить и взять следующий "/"-mapping.
        const assets = new FsAssetAccess({
            "long-exact-file-name.wasm": join(root, "onig.wasm"),
            "ext/": join(root, "ext"),
        });
        expect(await assets.readText("ext/ts/package.json")).toBe('{"name":"ts"}');
    });

    it("listEntries пропускает exact-mapping (без /) и берёт следующий", async () => {
        // Тот же случай для resolveDirToFs: exact-mapping не оканчивается на "/" →
        // пропускается, директория резолвится по "/"-mapping.
        const assets = new FsAssetAccess({
            "long-exact-file-name.wasm": join(root, "onig.wasm"),
            "ext/": join(root, "ext"),
        });
        const entries = (await assets.listEntries("ext/ts/")).map((e) => e.name).sort();
        expect(entries).toEqual(["package.json", "syntaxes"]);
    });

    it("listEntries бросает, если префикс не покрыт ни одним mapping", async () => {
        const assets = new FsAssetAccess({ "Extensions/builtin/": join(root, "ext") });
        await expect(assets.listEntries("Other/dir/")).rejects.toThrow(/No FS mapping for virtual prefix/);
    });
});
