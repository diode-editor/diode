import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setUnexpectedErrorHandler } from "../common/errors.ts";

import { lazyChunkAssetName, lazyChunkCacheAssetName, loadLazyModule, resetLazyModulesForTests } from "./lazyModule.ts";

/** A source that serves one chunk by asset name; anything else is "no chunk". */
function chunkSource(assetName: string, code: string) {
    return {
        read: vi.fn((name: string) => (name === assetName ? new TextEncoder().encode(code) : null)),
    };
}

const noChunk = { read: vi.fn(() => null) };

beforeEach(() => {
    resetLazyModulesForTests();
    noChunk.read.mockClear();
});

describe("lazyChunkAssetName", () => {
    it("lazy/<id>.cjs, as in scripts/build-lazy-chunks.mjs", () => {
        expect(lazyChunkAssetName("yauzl")).toBe("lazy/yauzl.cjs");
        expect(lazyChunkAssetName("@xterm/headless")).toBe("lazy/@xterm/headless.cjs");
    });

    it("code cache: lazy/<id>.v8cache", () => {
        expect(lazyChunkCacheAssetName("@xterm/headless")).toBe("lazy/@xterm/headless.v8cache");
    });
});

describe("loadLazyModule: V8 code cache", () => {
    const CODE = "exports.answer = (function () { return [1, 2, 3].reduce((a, b) => a + b, 36); })();\n";
    let dir: string;
    let errors: unknown[];

    beforeEach(() => {
        dir = mkdtempSync(path.join(tmpdir(), "diode-lazy-cache-"));
        errors = [];
        setUnexpectedErrorHandler((e) => errors.push(e));
    });
    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
        setUnexpectedErrorHandler((e) => {
            console.error(e);
        });
    });

    /** Cache taken by the same `scripts/lazy-chunk-code-cache.cjs` as the SEA build, but without the V8 snapshot. */
    function cacheFromBuild(assetName: string): Uint8Array {
        const chunk = path.join(dir, "chunk.cjs");
        const out = path.join(dir, "chunk.v8cache");
        writeFileSync(chunk, CODE);
        const env = { ...process.env };
        delete env.NODE_OPTIONS;
        execFileSync(process.execPath, ["scripts/lazy-chunk-code-cache.cjs", chunk, assetName, out], {
            env,
        });
        return readFileSync(out);
    }

    function sourceWith(assets: Record<string, Uint8Array>) {
        return { read: vi.fn((name: string) => assets[name] ?? null) };
    }

    it("the build cache is read next to the lazy chunk and accepted by V8: the build wrapper matches the loader byte for byte", async () => {
        const source = sourceWith({
            "lazy/cached.cjs": new TextEncoder().encode(CODE),
            "lazy/cached.v8cache": cacheFromBuild("lazy/cached.cjs"),
        });

        const mod = await loadLazyModule<Record<string, unknown>>("cached", () => Promise.resolve({}), source);

        expect(mod.answer).toBe(42);
        expect(source.read.mock.calls.map(([name]) => name)).toStrictEqual(["lazy/cached.cjs", "lazy/cached.v8cache"]);
        expect(errors).toStrictEqual([]);
    });

    it("V8 rejects a foreign cache: the lazy chunk still loads, the rejection goes to onUnexpectedError", async () => {
        const source = sourceWith({
            "lazy/stale.cjs": new TextEncoder().encode(`${CODE}exports.more = 1;\n`),
            "lazy/stale.v8cache": cacheFromBuild("lazy/stale.cjs"),
        });

        const mod = await loadLazyModule<Record<string, unknown>>("stale", () => Promise.resolve({}), source);

        expect(mod.answer).toBe(42);
        expect(mod.more).toBe(1);
        expect(errors).toHaveLength(1);
        expect(String(errors[0])).toContain("lazy/stale.cjs");
    });

    it("no cache: compiles without it, silently", async () => {
        const source = sourceWith({ "lazy/plain.cjs": new TextEncoder().encode(CODE) });

        const mod = await loadLazyModule<Record<string, unknown>>("plain", () => Promise.resolve({}), source);

        expect(mod.answer).toBe(42);
        expect(errors).toStrictEqual([]);
    });
});

describe("loadLazyModule", () => {
    it("no lazy chunk (dev): the module comes through the importer", async () => {
        const mod = { open: () => "real" };
        const importer = vi.fn(() => Promise.resolve(mod));

        await expect(loadLazyModule("pkg", importer, noChunk)).resolves.toBe(mod);
        expect(noChunk.read).toHaveBeenCalledWith("lazy/pkg.cjs");
        expect(importer).toHaveBeenCalledTimes(1);
    });

    it("reads packaged assets by default: the dev tree has no lazy chunk, so a real import()", async () => {
        const yauzl = await loadLazyModule("yauzl", () => import("yauzl"));
        expect(typeof yauzl.open).toBe("function");
    });

    it("lazy chunk present: runs CJS with a real require for builtins, named fields and default", async () => {
        const source = chunkSource(
            "lazy/pkg.cjs",
            'const path = require("node:path");\n' +
                "exports.join = (a, b) => path.posix.join(a, b);\n" +
                "exports.self = this === module.exports;\n" +
                "exports.where = [__filename, __dirname];\n",
        );
        const importer = vi.fn(() => Promise.reject(new Error("importer must not be called")));

        const mod = await loadLazyModule<Record<string, unknown>>("pkg", importer, source);

        expect(importer).not.toHaveBeenCalled();
        expect((mod.join as (a: string, b: string) => string)("a", "b")).toBe("a/b");
        expect(mod.self).toBe(true);
        expect(mod.where).toEqual(["diode:lazy/pkg.cjs", "diode:lazy"]);
        // default is module.exports itself, as with import() of CJS in node.
        expect((mod.default as Record<string, unknown>).join).toBe(mod.join);
    });

    it("module.exports is a function: it is default, its properties are named; exports.default does not override default", async () => {
        const source = chunkSource(
            "lazy/fn.cjs",
            "module.exports = function main() { return 42; };\n" +
                "module.exports.helper = 7;\n" +
                'module.exports.default = "not-the-default";\n',
        );

        const mod = await loadLazyModule<Record<string, unknown>>("fn", () => Promise.resolve({}), source);

        expect((mod.default as () => number)()).toBe(42);
        expect(mod.helper).toBe(7);
    });

    it("module.exports is a string: default only, character indices do not become fields", async () => {
        const source = chunkSource("lazy/prim.cjs", 'module.exports = "ab";\n');

        const mod = await loadLazyModule<Record<string, unknown>>("prim", () => Promise.resolve({}), source);

        expect(mod).toEqual({ default: "ab" });
    });

    it("module.exports is null: default only", async () => {
        const source = chunkSource("lazy/nul.cjs", "module.exports = null;\n");

        const mod = await loadLazyModule<Record<string, unknown>>("nul", () => Promise.resolve({}), source);

        expect(mod).toEqual({ default: null });
    });

    it("one load per process: the lazy chunk is read and run once", async () => {
        const source = chunkSource("lazy/once.cjs", "globalThis.__lazyRuns = (globalThis.__lazyRuns ?? 0) + 1;\n");
        const g = globalThis as { __lazyRuns?: number };
        delete g.__lazyRuns;

        const [a, b] = await Promise.all([
            loadLazyModule("once", () => Promise.resolve({}), source),
            loadLazyModule("once", () => Promise.resolve({}), source),
        ]);
        const c = await loadLazyModule("once", () => Promise.resolve({}), source);

        expect(a).toBe(b);
        expect(c).toBe(a);
        // The chunk and its code cache, once each.
        expect(source.read).toHaveBeenCalledTimes(2);
        expect(g.__lazyRuns).toBe(1);
        delete g.__lazyRuns;
    });

    it("different ids, different modules", async () => {
        const first = await loadLazyModule("a", () => Promise.resolve({ id: "a" }), noChunk);
        const second = await loadLazyModule("b", () => Promise.resolve({ id: "b" }), noChunk);

        expect(first).toEqual({ id: "a" });
        expect(second).toEqual({ id: "b" });
    });

    it("a failure does not stick: the lazy chunk error has a stack at diode:lazy/<id>.cjs, the next call retries", async () => {
        const broken = chunkSource("lazy/flaky.cjs", 'throw new Error("boom");\n');

        const error = await loadLazyModule("flaky", () => Promise.resolve({}), broken).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe("boom");
        expect((error as Error).stack).toContain("diode:lazy/flaky.cjs");

        const fixed = chunkSource("lazy/flaky.cjs", "exports.ok = true;\n");
        await expect(loadLazyModule("flaky", () => Promise.resolve({}), fixed)).resolves.toMatchObject({ ok: true });
    });
});
