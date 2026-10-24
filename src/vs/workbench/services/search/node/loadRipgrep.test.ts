import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { packBundle } from "../../../../base/common/assets/assetBundleFormat.ts";

import { loadRipgrepPath, resolveRipgrepPath, RIPGREP_PATH_ENV } from "./loadRipgrep.ts";

const RG = process.platform === "win32" ? "rg.exe" : "rg";

describe("resolveRipgrepPath", () => {
    let cacheRoot: string;

    beforeEach(() => {
        cacheRoot = mkdtempSync(path.join(tmpdir(), "diode-rg-cache-"));
    });
    afterEach(() => {
        rmSync(cacheRoot, { recursive: true, force: true });
    });

    it("dev: without a packed asset, the binary from @vscode/ripgrep", () => {
        const rgPath = resolveRipgrepPath(null);
        expect(rgPath).toMatch(/ripgrep/);
        expect(existsSync(rgPath)).toBe(true);
    });

    it("packed build: rg is unpacked into a cache by hash and is executable", () => {
        const bundle = packBundle([{ virtualPath: RG, data: Buffer.from("#!/bin/sh\necho rg") }]);

        const rgPath = resolveRipgrepPath(bundle, cacheRoot);

        expect(rgPath.startsWith(path.join(cacheRoot, "rg"))).toBe(true);
        expect(path.basename(rgPath)).toBe(RG);
        expect(readFileSync(rgPath, "utf8")).toBe("#!/bin/sh\necho rg");
        if (process.platform !== "win32") expect(statSync(rgPath).mode & 0o111).not.toBe(0);
        expect(resolveRipgrepPath(bundle, cacheRoot)).toBe(rgPath);
    });

    it("on Windows the bundle holds rg.exe", () => {
        const bundle = packBundle([{ virtualPath: "rg.exe", data: Buffer.from("MZ") }]);

        expect(path.basename(resolveRipgrepPath(bundle, cacheRoot, "win32"))).toBe("rg.exe");
        expect(path.basename(resolveRipgrepPath(bundle, cacheRoot, "linux"))).toBe("rg");
    });

    it("loadRipgrepPath caches the path per process (in dev, the same as from node_modules)", () => {
        const first = loadRipgrepPath();
        expect(first).toBe(resolveRipgrepPath(null));
        expect(loadRipgrepPath()).toBe(first);
    });
});

describe("loadRipgrepPath — DIODE_RIPGREP_PATH", () => {
    it("a set variable wins over the bundled rg", () => {
        expect(loadRipgrepPath({ [RIPGREP_PATH_ENV]: "/opt/fake/rg" })).toBe("/opt/fake/rg");
    });

    it("an empty variable is the same as unset: the bundled rg", () => {
        expect(loadRipgrepPath({ [RIPGREP_PATH_ENV]: "" })).toBe(loadRipgrepPath({}));
        expect(loadRipgrepPath({})).toMatch(/ripgrep/);
    });
});
