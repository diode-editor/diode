import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DIODE_VERSION } from "../../common/version.ts";
import { userCacheDir } from "../cachePaths.ts";

import { type IPackagedAssetEnvironment, packagedAssetCacheDir, readPackagedAsset } from "./packagedAsset.ts";

describe("readPackagedAsset", () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(path.join(tmpdir(), "diode-packaged-"));
    });
    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    const environment = (overrides: Partial<IPackagedAssetEnvironment>): IPackagedAssetEnvironment => ({
        isSea: () => false,
        readSeaAsset: () => {
            throw new Error("not a SEA binary");
        },
        entryDir: () => dir,
        ...overrides,
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
