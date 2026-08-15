import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";

import { packBundle } from "./assetBundleFormat.ts";
import { BundleAssetAccess } from "./bundleAssetAccess.ts";
import { bundleFileExists, bundleFilePath, readBundleFile, tryReadBundleFile } from "./bundleFile.ts";

const ONIG = new Uint8Array([0x00, 0x61, 0x73, 0x6d]);

describe("BundleFile", () => {
    let ws: ITempWorkspace;
    let dir: string;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "vexx-bundle-file-" });
        dir = ws.dir;
    });

    afterEach(() => {
        ws.dispose();
    });

    /** Кладёт рядом настоящий бандл — ровно так, как это делает build-selfextract. */
    function writeBundle(target: string = dir): void {
        const bundle = packBundle([
            { virtualPath: "onig.wasm", data: ONIG },
            { virtualPath: "Extensions/builtin/ts/package.json", data: new TextEncoder().encode('{"name":"ts"}') },
        ]);
        writeFileSync(join(target, "diode.bundle"), bundle);
    }

    it("резолвит путь рядом с main.js", () => {
        expect(bundleFilePath("/opt/vexx")).toBe(join("/opt/vexx", "diode.bundle"));
    });

    it("bundleFileExists отражает наличие файла", () => {
        expect(bundleFileExists(dir)).toBe(false);
        writeBundle();
        expect(bundleFileExists(dir)).toBe(true);
    });

    it("прочитанный с диска бандл скармливается BundleAssetAccess", async () => {
        writeBundle();

        const assets = new BundleAssetAccess(readBundleFile(dir));

        expect(Array.from(await assets.read("onig.wasm"))).toEqual(Array.from(ONIG));
        expect(await assets.readText("Extensions/builtin/ts/package.json")).toBe('{"name":"ts"}');
        expect(await assets.listEntries("Extensions/builtin/")).toEqual([{ name: "ts", isDirectory: true }]);
    });

    it("tryReadBundleFile отдаёт null, когда бандла рядом нет (dev-режим)", () => {
        expect(tryReadBundleFile(dir)).toBeNull();
    });

    it("readBundleFile бросает, когда бандла рядом нет", () => {
        expect(() => readBundleFile(dir)).toThrow(/diode\.bundle/);
    });

    it("tryReadBundleFile не глотает ошибки ФС кроме ENOENT", () => {
        // Каталог вместо файла — чтение даёт EISDIR, а не ENOENT: молча свалиться
        // в dev-режим здесь нельзя, это скрыло бы битую сборку.
        mkdirSync(bundleFilePath(dir));
        expect(() => tryReadBundleFile(dir)).toThrow();
    });

    it("битый бандл — ошибка разбора, а не тихий фолбэк", () => {
        writeFileSync(bundleFilePath(dir), Buffer.from("definitely not a bundle"));
        expect(() => new BundleAssetAccess(readBundleFile(dir))).toThrow(/magic/i);
    });
});
