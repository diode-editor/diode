import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import { packBundle } from "../../common/assets/assetBundleFormat.ts";
import { BundleAssetAccess } from "../../common/assets/bundleAssetAccess.ts";

import { bundleFileExists, bundleFilePath, readBundleFile, tryReadBundleFile } from "./bundleFile.ts";

const ONIG = new Uint8Array([0x00, 0x61, 0x73, 0x6d]);

describe("BundleFile", () => {
    let ws: ITempWorkspace;
    let dir: string;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-bundle-file-" });
        dir = ws.dir;
    });

    afterEach(() => {
        ws.dispose();
    });

    /** Puts a real bundle alongside, exactly as build-selfextract does. */
    function writeBundle(target: string = dir): void {
        const bundle = packBundle([
            { virtualPath: "onig.wasm", data: ONIG },
            { virtualPath: "Extensions/builtin/ts/package.json", data: new TextEncoder().encode('{"name":"ts"}') },
        ]);
        writeFileSync(join(target, "diode.bundle"), bundle);
    }

    it("resolves the path next to main.cjs", () => {
        expect(bundleFilePath("/opt/diode")).toBe(join("/opt/diode", "diode.bundle"));
    });

    it("bundleFileExists reflects whether the file exists", () => {
        expect(bundleFileExists(dir)).toBe(false);
        writeBundle();
        expect(bundleFileExists(dir)).toBe(true);
    });

    it("the bundle read from disk is fed to BundleAssetAccess", async () => {
        writeBundle();

        const assets = new BundleAssetAccess(readBundleFile(dir));

        expect(Array.from(await assets.read("onig.wasm"))).toEqual(Array.from(ONIG));
        expect(await assets.readText("Extensions/builtin/ts/package.json")).toBe('{"name":"ts"}');
        expect(await assets.listEntries("Extensions/builtin/")).toEqual([{ name: "ts", isDirectory: true }]);
    });

    it("tryReadBundleFile returns null when there is no bundle nearby (dev mode)", () => {
        expect(tryReadBundleFile(dir)).toBeNull();
    });

    it("readBundleFile throws when there is no bundle nearby", () => {
        expect(() => readBundleFile(dir)).toThrow(/diode\.bundle/);
    });

    it("tryReadBundleFile does not swallow fs errors other than ENOENT", () => {
        // A directory instead of a file: reading gives EISDIR, not ENOENT. Silently falling
        // back to dev mode here is not allowed, it would hide a broken build.
        mkdirSync(bundleFilePath(dir));
        expect(() => tryReadBundleFile(dir)).toThrow();
    });

    it("a broken bundle is a parse error, not a silent fallback", () => {
        writeFileSync(bundleFilePath(dir), Buffer.from("definitely not a bundle"));
        expect(() => new BundleAssetAccess(readBundleFile(dir))).toThrow(/magic/i);
    });
});
