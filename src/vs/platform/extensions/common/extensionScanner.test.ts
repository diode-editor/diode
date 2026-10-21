import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FsAssetAccess } from "../../../base/node/assets/fsAssetAccess.ts";

import { scanBuiltinExtensions } from "./extensionScanner.ts";

describe("scanBuiltinExtensions", () => {
    let tempDir: string;
    let assets: FsAssetAccess;
    const ROOT_PREFIX = "Extensions/builtin/";

    beforeEach(async () => {
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "diode-ext-scan-"));
        assets = new FsAssetAccess({ [ROOT_PREFIX]: tempDir });
    });

    afterEach(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    async function writeManifest(name: string, manifest: object): Promise<void> {
        const dir = path.join(tempDir, name);
        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.writeFile(path.join(dir, "package.json"), JSON.stringify(manifest));
    }

    it("reads a valid manifest and builds the id from publisher.name", async () => {
        await writeManifest("ts-basics", {
            name: "typescript",
            publisher: "vscode",
            version: "10.0.0",
        });

        const result = await scanBuiltinExtensions(assets, ROOT_PREFIX);

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe("vscode.typescript");
        expect(result[0].location).toBe(`${ROOT_PREFIX}ts-basics/`);
        expect(result[0].isBuiltin).toBe(true);
    });

    it("skips directories without package.json", async () => {
        await fs.promises.mkdir(path.join(tempDir, "empty"));
        const result = await scanBuiltinExtensions(assets, ROOT_PREFIX);
        expect(result).toEqual([]);
    });

    it("skips a manifest with invalid JSON", async () => {
        const dir = path.join(tempDir, "broken");
        await fs.promises.mkdir(dir);
        await fs.promises.writeFile(path.join(dir, "package.json"), "{not json");

        const result = await scanBuiltinExtensions(assets, ROOT_PREFIX);
        expect(result).toEqual([]);
    });

    it.each([
        ["name", { publisher: "p", version: "1.0.0" }],
        ["publisher", { name: "n", version: "1.0.0" }],
        ["version", { name: "n", publisher: "p" }],
    ])("skips a manifest without the %s field", async (_field, manifest) => {
        await writeManifest("ext", manifest);
        const result = await scanBuiltinExtensions(assets, ROOT_PREFIX);
        expect(result).toEqual([]);
    });

    it("returns an empty array when the root directory is missing", async () => {
        const missingAssets = new FsAssetAccess({ [ROOT_PREFIX]: path.join(tempDir, "missing") });
        const result = await scanBuiltinExtensions(missingAssets, ROOT_PREFIX);
        expect(result).toEqual([]);
    });

    it("keeps the full manifest unchanged", async () => {
        const manifest = {
            name: "css",
            publisher: "vscode",
            version: "1.0.0",
            engines: { vscode: "*" },
            contributes: { languages: [{ id: "css", extensions: [".css"] }] },
        };
        await writeManifest("css", manifest);

        const [ext] = await scanBuiltinExtensions(assets, ROOT_PREFIX);
        expect(ext.manifest).toEqual(manifest);
    });

    it("rootPrefix without a trailing / throws", async () => {
        await expect(scanBuiltinExtensions(assets, "Extensions/builtin")).rejects.toThrow();
    });

    it("skips top-level entries that are not directories", async () => {
        // A loose file right under rootPrefix is not an extension directory (entry.isDirectory === false).
        await fs.promises.writeFile(path.join(tempDir, "stray.txt"), "noise");
        await writeManifest("real-ext", { name: "n", publisher: "p", version: "1.0.0" });

        const result = await scanBuiltinExtensions(assets, ROOT_PREFIX);

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe("p.n");
    });
});
