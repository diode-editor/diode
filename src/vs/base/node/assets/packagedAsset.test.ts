import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DIODE_VERSION } from "../../common/version.ts";
import { userCacheDir } from "../cachePaths.ts";

import {
    type IPackagedAssetEnvironment,
    packagedAssetCacheDir,
    packagedAssetCacheDirByName,
    readPackagedAsset,
    readPackagedAssetView,
} from "./packagedAsset.ts";

let dir: string;

const environment = (overrides: Partial<IPackagedAssetEnvironment>): IPackagedAssetEnvironment => ({
    isSea: () => false,
    readSeaAsset: () => {
        throw new Error("not a SEA binary");
    },
    readSeaRawAsset: () => {
        throw new Error("not a SEA binary");
    },
    entryDir: () => dir,
    ...overrides,
});

describe("readPackagedAsset", () => {
    beforeEach(() => {
        dir = mkdtempSync(path.join(tmpdir(), "diode-packaged-"));
    });
    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it("SEA: bytes of the embedded asset", () => {
        const seen: string[] = [];
        const bytes = readPackagedAsset(
            "rg.bundle",
            environment({
                isSea: () => true,
                readSeaAsset: (name) => {
                    seen.push(name);
                    return new Uint8Array([1, 2, 3]).buffer;
                },
            }),
        );

        expect(seen).toEqual(["rg.bundle"]);
        expect([...(bytes ?? [])]).toEqual([1, 2, 3]);
    });

    it("self-extract: file next to the entry script", () => {
        writeFileSync(path.join(dir, "ts-server.bundle"), Buffer.from([7, 8]));

        expect([...(readPackagedAsset("ts-server.bundle", environment({})) ?? [])]).toEqual([7, 8]);
    });

    it("dev: no file or a non-file entry: null", () => {
        expect(readPackagedAsset("rg.bundle", environment({}))).toBeNull();
        expect(readPackagedAsset("rg.bundle", environment({ entryDir: () => null }))).toBeNull();
    });

    it("looks at the real process by default: there are no assets under tests", () => {
        expect(readPackagedAsset("rg.bundle")).toBeNull();
    });
});

describe("readPackagedAssetView", () => {
    beforeEach(() => {
        dir = mkdtempSync(path.join(tmpdir(), "diode-packaged-"));
    });
    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it("SEA: a view of the asset without a copy (getRawAsset, not getAsset); no asset: null", () => {
        const raw = new Uint8Array([4, 5, 6]).buffer;
        const seen: string[] = [];
        const env = environment({
            isSea: () => true,
            readSeaRawAsset: (name) => {
                seen.push(name);
                return name === "lazy/x.cjs" ? raw : null;
            },
        });

        const view = readPackagedAssetView("lazy/x.cjs", env);
        expect(view?.buffer).toBe(raw);
        expect([...(view ?? [])]).toEqual([4, 5, 6]);
        expect(readPackagedAssetView("lazy/x.v8cache", env)).toBeNull();
        expect(seen).toEqual(["lazy/x.cjs", "lazy/x.v8cache"]);
    });

    it("self-extract: file next to the entry script; dev: null", () => {
        writeFileSync(path.join(dir, "x.cjs"), Buffer.from([9]));

        expect([...(readPackagedAssetView("x.cjs", environment({})) ?? [])]).toEqual([9]);
        expect(readPackagedAssetView("y.cjs", environment({}))).toBeNull();
        expect(readPackagedAssetView("x.cjs", environment({ entryDir: () => null }))).toBeNull();
        expect(readPackagedAssetView("lazy/yauzl.cjs")).toBeNull();
    });
});

describe("packagedAssetCacheDir", () => {
    it("the key is the version and content hash, not the size", () => {
        const a = packagedAssetCacheDir("rg", new Uint8Array([1, 2, 3]), "/cache");
        const sameSize = packagedAssetCacheDir("rg", new Uint8Array([3, 2, 1]), "/cache");

        expect(a).toBe(path.join("/cache", "rg", `${DIODE_VERSION}-039058c6f2c0`));
        expect(sameSize).not.toBe(a);
        expect(packagedAssetCacheDir("rg", new Uint8Array([1, 2, 3]), "/cache")).toBe(a);
    });

    it("defaults to the user's diode cache", () => {
        expect(packagedAssetCacheDir("node-pty", new Uint8Array([1]))).toMatch(
            new RegExp(`^${userCacheDir().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
        );
    });
});

describe("packagedAssetCacheDirByName", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    // sha256([1, 2, 3])
    const digest = "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81";

    beforeEach(() => {
        dir = mkdtempSync(path.join(tmpdir(), "diode-packaged-"));
    });
    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it("SEA: the key comes from the `<name>.sha256` sidecar; the asset bytes are not read", () => {
        const seen: string[] = [];
        const env = environment({
            isSea: () => true,
            readSeaRawAsset: (name) => {
                seen.push(name);
                return name === "ts-server.bundle.sha256" ? new TextEncoder().encode(`${digest}\n`).buffer : null;
            },
        });

        expect(packagedAssetCacheDirByName("ts-server", "ts-server.bundle", env, "/cache")).toBe(
            packagedAssetCacheDir("ts-server", bytes, "/cache"),
        );
        expect(seen).toEqual(["ts-server.bundle.sha256"]);
    });

    it("no sidecar or a broken one: hash over the bytes, same key", () => {
        writeFileSync(path.join(dir, "ts-server.bundle"), bytes);
        const expected = packagedAssetCacheDir("ts-server", bytes, "/cache");

        expect(packagedAssetCacheDirByName("ts-server", "ts-server.bundle", environment({}), "/cache")).toBe(expected);
        writeFileSync(path.join(dir, "ts-server.bundle.sha256"), "not-a-digest");
        expect(packagedAssetCacheDirByName("ts-server", "ts-server.bundle", environment({}), "/cache")).toBe(expected);
        // Exactly 64 hex characters and nothing around them: one character short, junk before or after is broken.
        // The tail belongs to ANOTHER digest: a key from it would differ from the expected one rather than match by chance.
        const other = "f".repeat(64);
        for (const broken of [digest.slice(1), `x${digest}`, `${other}x`]) {
            writeFileSync(path.join(dir, "ts-server.bundle.sha256"), broken);
            expect(packagedAssetCacheDirByName("ts-server", "ts-server.bundle", environment({}), "/cache")).toBe(
                expected,
            );
        }
    });

    it("self-extract: sidecar file next to main.cjs", () => {
        writeFileSync(path.join(dir, "ts-server.bundle.sha256"), digest);

        expect(packagedAssetCacheDirByName("ts-server", "ts-server.bundle", environment({}), "/cache")).toBe(
            path.join("/cache", "ts-server", `${DIODE_VERSION}-039058c6f2c0`),
        );
    });

    it("neither asset nor sidecar (dev): null; defaults to the user cache", () => {
        expect(packagedAssetCacheDirByName("ts-server", "ts-server.bundle", environment({}), "/cache")).toBeNull();
        expect(packagedAssetCacheDirByName("ts-server", "ts-server.bundle")).toBeNull();
        writeFileSync(path.join(dir, "ts-server.bundle.sha256"), digest);
        expect(packagedAssetCacheDirByName("ts-server", "ts-server.bundle", environment({}))).toMatch(
            new RegExp(`^${userCacheDir().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
        );
    });
});
