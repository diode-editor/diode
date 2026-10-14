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

    it("SEA: байты вшитого ассета", () => {
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

    it("self-extract: файл рядом с entry-скриптом", () => {
        writeFileSync(path.join(dir, "ts-server.bundle"), Buffer.from([7, 8]));

        expect([...(readPackagedAsset("ts-server.bundle", environment({})) ?? [])]).toEqual([7, 8]);
    });

    it("dev: файла нет или entry не файловый — null", () => {
        expect(readPackagedAsset("rg.bundle", environment({}))).toBeNull();
        expect(readPackagedAsset("rg.bundle", environment({ entryDir: () => null }))).toBeNull();
    });

    it("по умолчанию смотрит в настоящий процесс: под тестами ассетов нет", () => {
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

    it("SEA: вид на ассет без копии (getRawAsset, а не getAsset); ассета нет — null", () => {
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

    it("self-extract: файл рядом с entry-скриптом; dev — null", () => {
        writeFileSync(path.join(dir, "x.cjs"), Buffer.from([9]));

        expect([...(readPackagedAssetView("x.cjs", environment({})) ?? [])]).toEqual([9]);
        expect(readPackagedAssetView("y.cjs", environment({}))).toBeNull();
        expect(readPackagedAssetView("x.cjs", environment({ entryDir: () => null }))).toBeNull();
        expect(readPackagedAssetView("lazy/yauzl.cjs")).toBeNull();
    });
});

describe("packagedAssetCacheDir", () => {
    it("ключ — версия и хэш содержимого, а не размер", () => {
        const a = packagedAssetCacheDir("rg", new Uint8Array([1, 2, 3]), "/cache");
        const sameSize = packagedAssetCacheDir("rg", new Uint8Array([3, 2, 1]), "/cache");

        expect(a).toBe(path.join("/cache", "rg", `${DIODE_VERSION}-039058c6f2c0`));
        expect(sameSize).not.toBe(a);
        expect(packagedAssetCacheDir("rg", new Uint8Array([1, 2, 3]), "/cache")).toBe(a);
    });

    it("по умолчанию — под пользовательским кэшем diode", () => {
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

    it("SEA: ключ из сайдкара `<имя>.sha256`, байты самого ассета не читаются", () => {
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

    it("сайдкара нет или он битый — хэш по байтам, ключ тот же", () => {
        writeFileSync(path.join(dir, "ts-server.bundle"), bytes);
        const expected = packagedAssetCacheDir("ts-server", bytes, "/cache");

        expect(packagedAssetCacheDirByName("ts-server", "ts-server.bundle", environment({}), "/cache")).toBe(expected);
        writeFileSync(path.join(dir, "ts-server.bundle.sha256"), "not-a-digest");
        expect(packagedAssetCacheDirByName("ts-server", "ts-server.bundle", environment({}), "/cache")).toBe(expected);
        // Ровно 64 hex-символа: дайджест на символ короче — битый.
        writeFileSync(path.join(dir, "ts-server.bundle.sha256"), digest.slice(1));
        expect(packagedAssetCacheDirByName("ts-server", "ts-server.bundle", environment({}), "/cache")).toBe(expected);
    });

    it("self-extract: сайдкар файлом рядом с main.js", () => {
        writeFileSync(path.join(dir, "ts-server.bundle.sha256"), digest);

        expect(packagedAssetCacheDirByName("ts-server", "ts-server.bundle", environment({}), "/cache")).toBe(
            path.join("/cache", "ts-server", `${DIODE_VERSION}-039058c6f2c0`),
        );
    });

    it("ни ассета, ни сайдкара (dev) — null; по умолчанию — под пользовательским кэшем", () => {
        expect(packagedAssetCacheDirByName("ts-server", "ts-server.bundle", environment({}), "/cache")).toBeNull();
        expect(packagedAssetCacheDirByName("ts-server", "ts-server.bundle")).toBeNull();
        writeFileSync(path.join(dir, "ts-server.bundle.sha256"), digest);
        expect(packagedAssetCacheDirByName("ts-server", "ts-server.bundle", environment({}))).toMatch(
            new RegExp(`^${userCacheDir().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
        );
    });
});
