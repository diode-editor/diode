import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setUnexpectedErrorHandler } from "../common/errors.ts";

import { lazyChunkAssetName, lazyChunkCacheAssetName, loadLazyModule, resetLazyModulesForTests } from "./lazyModule.ts";

/** Источник, отдающий один кусок по имени ассета; всё прочее — «куска нет». */
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
    it("lazy/<id>.cjs — как в scripts/build-lazy-chunks.mjs", () => {
        expect(lazyChunkAssetName("yauzl")).toBe("lazy/yauzl.cjs");
        expect(lazyChunkAssetName("@xterm/headless")).toBe("lazy/@xterm/headless.cjs");
    });

    it("кэш кода — lazy/<id>.v8cache", () => {
        expect(lazyChunkCacheAssetName("@xterm/headless")).toBe("lazy/@xterm/headless.v8cache");
    });
});

describe("loadLazyModule — кэш кода V8", () => {
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

    /**
     * Кэш, снятый тем же скриптом, что у сборки SEA (`scripts/lazy-chunk-code-cache.cjs`),
     * но голым node, без снапшота: сборка снимает его внутри V8-снапшота под бинарь,
     * а этот процесс — без снапшота. Обёртка и прогрев — одни и те же.
     */
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

    it("кэш из сборки читается рядом с куском и принят V8: обёртка сборки байт в байт как у загрузчика", async () => {
        const source = sourceWith({
            "lazy/cached.cjs": new TextEncoder().encode(CODE),
            "lazy/cached.v8cache": cacheFromBuild("lazy/cached.cjs"),
        });

        const mod = await loadLazyModule<Record<string, unknown>>("cached", () => Promise.resolve({}), source);

        expect(mod.answer).toBe(42);
        expect(source.read.mock.calls.map(([name]) => name)).toStrictEqual(["lazy/cached.cjs", "lazy/cached.v8cache"]);
        expect(errors).toStrictEqual([]);
    });

    it("чужой кэш V8 отвергает: кусок всё равно загружен, отказ — в onUnexpectedError", async () => {
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

    it("кэша нет — компилируем без него, молча", async () => {
        const source = sourceWith({ "lazy/plain.cjs": new TextEncoder().encode(CODE) });

        const mod = await loadLazyModule<Record<string, unknown>>("plain", () => Promise.resolve({}), source);

        expect(mod.answer).toBe(42);
        expect(errors).toStrictEqual([]);
    });
});

describe("loadLazyModule", () => {
    it("куска нет (dev) — модуль приходит через importer", async () => {
        const mod = { open: () => "real" };
        const importer = vi.fn(() => Promise.resolve(mod));

        await expect(loadLazyModule("pkg", importer, noChunk)).resolves.toBe(mod);
        expect(noChunk.read).toHaveBeenCalledWith("lazy/pkg.cjs");
        expect(importer).toHaveBeenCalledTimes(1);
    });

    it("по умолчанию читает упакованные ассеты: в dev-дереве куска нет — настоящий import()", async () => {
        const yauzl = await loadLazyModule("yauzl", () => import("yauzl"));
        expect(typeof yauzl.open).toBe("function");
    });

    it("кусок есть — исполняет CJS: настоящий require builtin'ов, именованные поля и default", async () => {
        const source = chunkSource(
            "lazy/pkg.cjs",
            'const path = require("node:path");\n' +
                "exports.join = (a, b) => path.posix.join(a, b);\n" +
                "exports.self = this === module.exports;\n" +
                "exports.where = [__filename, __dirname];\n",
        );
        const importer = vi.fn(() => Promise.reject(new Error("importer не должен вызываться")));

        const mod = await loadLazyModule<Record<string, unknown>>("pkg", importer, source);

        expect(importer).not.toHaveBeenCalled();
        expect((mod.join as (a: string, b: string) => string)("a", "b")).toBe("a/b");
        expect(mod.self).toBe(true);
        expect(mod.where).toEqual(["diode:lazy/pkg.cjs", "diode:lazy"]);
        // default — сам module.exports, как у import() над CJS в node.
        expect((mod.default as Record<string, unknown>).join).toBe(mod.join);
    });

    it("module.exports — функция: default — она, её свойства — именованные; exports.default не перебивает default", async () => {
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

    it("module.exports — строка: только default, индексы символов в поля не попадают", async () => {
        const source = chunkSource("lazy/prim.cjs", 'module.exports = "ab";\n');

        const mod = await loadLazyModule<Record<string, unknown>>("prim", () => Promise.resolve({}), source);

        expect(mod).toEqual({ default: "ab" });
    });

    it("module.exports — null: только default", async () => {
        const source = chunkSource("lazy/nul.cjs", "module.exports = null;\n");

        const mod = await loadLazyModule<Record<string, unknown>>("nul", () => Promise.resolve({}), source);

        expect(mod).toEqual({ default: null });
    });

    it("загрузка одна на процесс: кусок читается и исполняется один раз", async () => {
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
        // Кусок и его кэш кода — по разу.
        expect(source.read).toHaveBeenCalledTimes(2);
        expect(g.__lazyRuns).toBe(1);
        delete g.__lazyRuns;
    });

    it("разные id — разные модули", async () => {
        const first = await loadLazyModule("a", () => Promise.resolve({ id: "a" }), noChunk);
        const second = await loadLazyModule("b", () => Promise.resolve({ id: "b" }), noChunk);

        expect(first).toEqual({ id: "a" });
        expect(second).toEqual({ id: "b" });
    });

    it("сбой не залипает: ошибка куска со стеком на diode:lazy/<id>.cjs, следующий вызов пробует снова", async () => {
        const broken = chunkSource("lazy/flaky.cjs", 'throw new Error("boom");\n');

        const error = await loadLazyModule("flaky", () => Promise.resolve({}), broken).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe("boom");
        expect((error as Error).stack).toContain("diode:lazy/flaky.cjs");

        const fixed = chunkSource("lazy/flaky.cjs", "exports.ok = true;\n");
        await expect(loadLazyModule("flaky", () => Promise.resolve({}), fixed)).resolves.toMatchObject({ ok: true });
    });
});
