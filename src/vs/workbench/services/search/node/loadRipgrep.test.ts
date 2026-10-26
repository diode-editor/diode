import {
    existsSync,
    lstatSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { packBundle, readBundleHeader } from "../../../../base/common/assets/assetBundleFormat.ts";

import {
    loadRipgrepAppRoot,
    loadRipgrepPath,
    resolveRipgrepLayout,
    RIPGREP_APP_ROOT_DIR,
    RIPGREP_PATH_ENV,
} from "./loadRipgrep.ts";

const RG = process.platform === "win32" ? "rg.exe" : "rg";
const VSCODE_RG = `node_modules/@vscode/ripgrep/bin/${RG}`;
const REPO_ROOT = path.resolve(import.meta.dirname, "../../../../../..");

interface IPackRipgrepScript {
    readonly RIPGREP_APP_ROOT_DIR: string;
    buildRipgrepBundle(params: { repoRoot: string }): { bundle: Uint8Array };
}

describe("resolveRipgrepLayout", () => {
    let cacheRoot: string;

    beforeEach(() => {
        cacheRoot = mkdtempSync(path.join(tmpdir(), "diode-rg-cache-"));
    });
    afterEach(() => {
        rmSync(cacheRoot, { recursive: true, force: true });
    });

    it("packed build: rg is unpacked at VS Code's path inside the app root, executable, reused", () => {
        const bundle = packBundle([{ virtualPath: VSCODE_RG, data: Buffer.from("#!/bin/sh\necho rg") }]);

        const layout = resolveRipgrepLayout(bundle, cacheRoot);

        expect(layout.appRoot.startsWith(path.join(cacheRoot, "rg"))).toBe(true);
        expect(layout.rgPath).toBe(path.join(layout.appRoot, VSCODE_RG));
        expect(readFileSync(layout.rgPath, "utf8")).toBe("#!/bin/sh\necho rg");
        if (process.platform !== "win32") expect(statSync(layout.rgPath).mode & 0o111).not.toBe(0);
        expect(resolveRipgrepLayout(bundle, cacheRoot)).toStrictEqual(layout);
    });

    it("on Windows the layout holds rg.exe", () => {
        const bundle = packBundle([
            { virtualPath: "node_modules/@vscode/ripgrep/bin/rg.exe", data: Buffer.from("MZ") },
        ]);

        expect(path.basename(resolveRipgrepLayout(bundle, cacheRoot, "win32").rgPath)).toBe("rg.exe");
        expect(path.basename(resolveRipgrepLayout(bundle, cacheRoot, "linux").rgPath)).toBe("rg");
    });

    it("pack-ripgrep packs the binary at the path the build looks for", async () => {
        const script = (await import(
            new URL("../../../../../../scripts/pack-ripgrep.mjs", import.meta.url).href
        )) as IPackRipgrepScript;
        expect(script.RIPGREP_APP_ROOT_DIR).toBe(RIPGREP_APP_ROOT_DIR);
        const { bundle } = script.buildRipgrepBundle({ repoRoot: REPO_ROOT });
        expect(Object.keys(readBundleHeader(bundle).header.files)).toStrictEqual([VSCODE_RG]);
    });

    it("packed build with an unwritable cache throws: there is no other rg", () => {
        const bundle = packBundle([{ virtualPath: VSCODE_RG, data: Buffer.from("x") }]);
        const blocker = path.join(cacheRoot, "file");
        writeFileSync(blocker, "");

        expect(() => resolveRipgrepLayout(bundle, blocker)).toThrow();
    });

    it("dev: the app root links the real @vscode/ripgrep binary at VS Code's path", () => {
        const layout = resolveRipgrepLayout(null, cacheRoot);

        expect(layout.appRoot.startsWith(path.join(cacheRoot, "rg"))).toBe(true);
        expect(layout.rgPath).toBe(path.join(layout.appRoot, VSCODE_RG));
        expect(existsSync(layout.rgPath)).toBe(true);
        expect(lstatSync(layout.rgPath).isSymbolicLink()).toBe(process.platform !== "win32");
        expect(realpathSync(layout.rgPath)).toBe(realpathSync(nodeModulesRgPath()));
        expect(resolveRipgrepLayout(null, cacheRoot)).toStrictEqual(layout);
    });

    it("dev on Windows: a copy instead of a symlink, named rg.exe", () => {
        const source = path.join(cacheRoot, "rg-source");
        writeFileSync(source, "MZ");

        const layout = resolveRipgrepLayout(null, path.join(cacheRoot, "c"), "win32", () => source);

        expect(path.basename(layout.rgPath)).toBe("rg.exe");
        expect(lstatSync(layout.rgPath).isSymbolicLink()).toBe(false);
        expect(readFileSync(layout.rgPath, "utf8")).toBe("MZ");
    });

    it("dev: another binary or another checkout gets its own directory, not a stale link", () => {
        const a = path.join(cacheRoot, "a");
        const b = path.join(cacheRoot, "b");
        writeFileSync(a, "one");
        writeFileSync(b, "one");
        const root = path.join(cacheRoot, "c");

        const fromA = resolveRipgrepLayout(null, root, "linux", () => a);
        const fromB = resolveRipgrepLayout(null, root, "linux", () => b);
        writeFileSync(a, "two");
        const changed = resolveRipgrepLayout(null, root, "linux", () => a);

        expect(new Set([fromA.appRoot, fromB.appRoot, changed.appRoot]).size).toBe(3);
        expect(readFileSync(changed.rgPath, "utf8")).toBe("two");
    });

    it("dev with an unwritable cache: no app root, the core still gets the node_modules binary", () => {
        const source = path.join(cacheRoot, "rg-source");
        writeFileSync(source, "x");
        const blocker = path.join(cacheRoot, "file");
        writeFileSync(blocker, "");

        expect(resolveRipgrepLayout(null, blocker, "linux", () => source)).toStrictEqual({
            appRoot: "",
            rgPath: source,
        });
    });
});

function nodeModulesRgPath(): string {
    return (createRequire(import.meta.url)("@vscode/ripgrep") as { rgPath: string }).rgPath;
}

describe("loadRipgrepPath / loadRipgrepAppRoot", () => {
    it("the core's rg is the one inside the app root, the same on every call", () => {
        const appRoot = loadRipgrepAppRoot();
        expect(appRoot).not.toBe("");
        expect(loadRipgrepPath({})).toBe(path.join(appRoot, VSCODE_RG));
        expect(existsSync(loadRipgrepPath({}))).toBe(true);
        expect(loadRipgrepAppRoot()).toBe(appRoot);
    });

    it("a set DIODE_RIPGREP_PATH wins over the bundled rg and leaves the app root alone", () => {
        expect(loadRipgrepPath({ [RIPGREP_PATH_ENV]: "/opt/fake/rg" })).toBe("/opt/fake/rg");
        expect(existsSync(path.join(loadRipgrepAppRoot(), VSCODE_RG))).toBe(true);
    });

    it("an empty variable is the same as unset: the bundled rg", () => {
        expect(loadRipgrepPath({ [RIPGREP_PATH_ENV]: "" })).toBe(loadRipgrepPath({}));
    });

    it("a layout that cannot be created gives an empty app root, as upstream without one", () => {
        expect(
            loadRipgrepAppRoot(() => {
                throw new Error("EROFS");
            }),
        ).toBe("");
    });
});
