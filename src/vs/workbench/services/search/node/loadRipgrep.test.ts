import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { packBundle } from "../../../../base/common/assets/assetBundleFormat.ts";

import { loadRipgrepPath, resolveRipgrepPath } from "./loadRipgrep.ts";

const RG = process.platform === "win32" ? "rg.exe" : "rg";

describe("resolveRipgrepPath", () => {
    let cacheRoot: string;

    beforeEach(() => {
        cacheRoot = mkdtempSync(path.join(tmpdir(), "diode-rg-cache-"));
    });
    afterEach(() => {
        rmSync(cacheRoot, { recursive: true, force: true });
    });

    it("dev: без упакованного ассета — бинарь из @vscode/ripgrep", () => {
        const rgPath = resolveRipgrepPath(null);
        expect(rgPath).toMatch(/ripgrep/);
        expect(existsSync(rgPath)).toBe(true);
    });

    it("упакованная сборка: rg распакован в кэш по хэшу и исполняем", () => {
        const bundle = packBundle([{ virtualPath: RG, data: Buffer.from("#!/bin/sh\necho rg") }]);

        const rgPath = resolveRipgrepPath(bundle, cacheRoot);

        expect(rgPath.startsWith(path.join(cacheRoot, "rg"))).toBe(true);
        expect(path.basename(rgPath)).toBe(RG);
        expect(readFileSync(rgPath, "utf8")).toBe("#!/bin/sh\necho rg");
        if (process.platform !== "win32") expect(statSync(rgPath).mode & 0o111).not.toBe(0);
        // Повторный вызов — тот же каталог, без перераспаковки.
        expect(resolveRipgrepPath(bundle, cacheRoot)).toBe(rgPath);
    });

    it("на Windows в бандле лежит rg.exe", () => {
        const bundle = packBundle([{ virtualPath: "rg.exe", data: Buffer.from("MZ") }]);

        expect(path.basename(resolveRipgrepPath(bundle, cacheRoot, "win32"))).toBe("rg.exe");
        expect(path.basename(resolveRipgrepPath(bundle, cacheRoot, "linux"))).toBe("rg");
    });

    it("loadRipgrepPath кэширует путь на процесс (в dev — тот же, что из node_modules)", () => {
        const first = loadRipgrepPath();
        expect(first).toBe(resolveRipgrepPath(null));
        expect(loadRipgrepPath()).toBe(first);
    });
});
