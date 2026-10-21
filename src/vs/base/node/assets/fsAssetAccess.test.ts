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

    it("reads text assets via a prefix mapping", async () => {
        const assets = new FsAssetAccess({ "Extensions/builtin/": join(root, "ext") });
        expect(await assets.readText("Extensions/builtin/ts/package.json")).toBe('{"name":"ts"}');
    });

    it("reads binary assets via an exact mapping", async () => {
        const assets = new FsAssetAccess({ "onig.wasm": join(root, "onig.wasm") });
        expect(Array.from(await assets.read("onig.wasm"))).toEqual([1, 2, 3]);
    });

    it("exists() returns true/false", async () => {
        const assets = new FsAssetAccess({ "Extensions/builtin/": join(root, "ext") });
        expect(await assets.exists("Extensions/builtin/ts/package.json")).toBe(true);
        expect(await assets.exists("Extensions/builtin/ts/missing.json")).toBe(false);
    });

    it("listEntries returns the directory's child entries", async () => {
        const assets = new FsAssetAccess({ "Extensions/builtin/": join(root, "ext") });
        const entries = (await assets.listEntries("Extensions/builtin/")).sort((a, b) => a.name.localeCompare(b.name));
        expect(entries).toEqual([{ name: "ts", isDirectory: true }]);

        const tsEntries = (await assets.listEntries("Extensions/builtin/ts/")).map((e) => e.name).sort();
        expect(tsEntries).toEqual(["package.json", "syntaxes"]);
    });

    it("throws for a path without a mapping", async () => {
        const assets = new FsAssetAccess({ "Extensions/builtin/": join(root, "ext") });
        await expect(assets.read("unmapped.bin")).rejects.toThrow(/No FS mapping/);
    });

    it("validates virtual paths (`..` is forbidden)", async () => {
        const assets = new FsAssetAccess({ "Extensions/builtin/": join(root, "ext") });
        await expect(assets.read("Extensions/../escape")).rejects.toThrow();
    });

    it("listEntries without a trailing / throws", async () => {
        const assets = new FsAssetAccess({ "Extensions/builtin/": join(root, "ext") });
        await expect(assets.listEntries("Extensions/builtin")).rejects.toThrow(/must end with/);
    });

    it("listEntries returns [] for a missing directory", async () => {
        const assets = new FsAssetAccess({ "Extensions/builtin/": join(root, "ext") });
        expect(await assets.listEntries("Extensions/builtin/nope/")).toEqual([]);
    });

    it('listEntries with an empty prefix throws if there is no mapping for ""', async () => {
        const assets = new FsAssetAccess({ "Extensions/builtin/": join(root, "ext") });
        await expect(assets.listEntries("")).rejects.toThrow(/empty virtual prefix/);
    });

    it('listEntries with an empty prefix reads root if it is mapped to ""', async () => {
        const assets = new FsAssetAccess({ "": join(root, "ext") });
        const entries = (await assets.listEntries("")).map((e) => e.name).sort();
        expect(entries).toEqual(["ts"]);
    });

    it("read skips a non-matching exact mapping and takes the next one", async () => {
        // The long exact prefix sorts first but doesn't match the path →
        // resolveToFs must skip it and take the next "/" mapping.
        const assets = new FsAssetAccess({
            "long-exact-file-name.wasm": join(root, "onig.wasm"),
            "ext/": join(root, "ext"),
        });
        expect(await assets.readText("ext/ts/package.json")).toBe('{"name":"ts"}');
    });

    it("listEntries skips an exact mapping (no /) and takes the next one", async () => {
        // Same case for resolveDirToFs: the exact mapping doesn't end with "/" →
        // it is skipped, the directory resolves via the "/" mapping.
        const assets = new FsAssetAccess({
            "long-exact-file-name.wasm": join(root, "onig.wasm"),
            "ext/": join(root, "ext"),
        });
        const entries = (await assets.listEntries("ext/ts/")).map((e) => e.name).sort();
        expect(entries).toEqual(["package.json", "syntaxes"]);
    });

    it("listEntries throws if no mapping covers the prefix", async () => {
        const assets = new FsAssetAccess({ "Extensions/builtin/": join(root, "ext") });
        await expect(assets.listEntries("Other/dir/")).rejects.toThrow(/No FS mapping for virtual prefix/);
    });
});
