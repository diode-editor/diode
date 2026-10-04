import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { packBundle } from "../../common/assets/assetBundleFormat.ts";

import { extractBundleToCache, extractBundleToCacheSync, READY_MARKER } from "./extractBundleToCache.ts";

// Распаковка бандла в кэш: идемпотентность, атомарная публикация (rename),
// мьютекс mkdir-lock — схема self-extract-стаба, перенесённая в TS.

describe("extractBundleToCache", () => {
    let root: string;

    const bundle = () =>
        packBundle([
            { virtualPath: "server/lib/cli.mjs", data: Buffer.from("console.log('cli')") },
            { virtualPath: "node_modules/typescript/lib/tsserver.js", data: Buffer.from("// tsserver") },
        ]);

    beforeEach(() => {
        root = mkdtempSync(path.join(tmpdir(), "diode-extract-"));
    });

    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    it("распаковывает дерево, ставит .diode-ready, лок не остаётся", async () => {
        const target = path.join(root, "v1-abc");
        await extractBundleToCache(bundle(), target);

        expect(readFileSync(path.join(target, "server/lib/cli.mjs"), "utf8")).toBe("console.log('cli')");
        expect(readFileSync(path.join(target, "node_modules/typescript/lib/tsserver.js"), "utf8")).toBe("// tsserver");
        expect(existsSync(path.join(target, READY_MARKER))).toBe(true);
        expect(existsSync(`${target}.lock`)).toBe(false);
    });

    it("повторный вызов — мгновенный no-op: распакованное не перезаписывается", async () => {
        const target = path.join(root, "v1-abc");
        await extractBundleToCache(bundle(), target);
        writeFileSync(path.join(target, "server/lib/cli.mjs"), "edited after unpack");

        await extractBundleToCache(bundle(), target);
        expect(readFileSync(path.join(target, "server/lib/cli.mjs"), "utf8")).toBe("edited after unpack");
    });

    it("незавершённый мусор прошлого падения затирается под локом", async () => {
        const target = path.join(root, "v1-abc");
        // Полураспакованный каталог БЕЗ .diode-ready — как после падения между
        // писанием файлов и публикацией (в норме ненаблюдаемо: пишем во tmp).
        mkdirSync(target, { recursive: true });
        writeFileSync(path.join(target, "garbage"), "stale");

        await extractBundleToCache(bundle(), target);
        expect(existsSync(path.join(target, "garbage"))).toBe(false);
        expect(existsSync(path.join(target, READY_MARKER))).toBe(true);
    });

    it("конкурент с локом: ждём его .diode-ready", async () => {
        const target = path.join(root, "v1-abc");
        mkdirSync(`${target}.lock`); // «чужой» владелец распаковывает
        const done = extractBundleToCache(bundle(), target, { waitTimeoutMs: 3_000, pollIntervalMs: 10 });

        // «Владелец» публикует каталог через 50 мс.
        setTimeout(() => {
            mkdirSync(target, { recursive: true });
            writeFileSync(path.join(target, READY_MARKER), "");
            rmSync(`${target}.lock`, { recursive: true, force: true });
        }, 50);

        await expect(done).resolves.toBeUndefined();
        // Распаковывал «владелец», а не мы: файлов бандла в каталоге нет.
        expect(existsSync(path.join(target, "server/lib/cli.mjs"))).toBe(false);
    });

    it("stale lock: таймаут с внятной подсказкой", async () => {
        const target = path.join(root, "v1-abc");
        mkdirSync(`${target}.lock`);

        await expect(
            extractBundleToCache(bundle(), target, { waitTimeoutMs: 120, pollIntervalMs: 20 }),
        ).rejects.toThrow(
            `diode: timed out waiting for cache unpack at ${target}. ` +
                `If no other diode is starting, remove the stale lock: rm -rf '${target}.lock'`,
        );
    });

    it.skipIf(process.platform === "win32")("не-EEXIST ошибка лока пробрасывается (readonly cacheRoot)", async () => {
        const readonlyRoot = path.join(root, "ro");
        mkdirSync(readonlyRoot);
        chmodSync(readonlyRoot, 0o500);
        try {
            await expect(extractBundleToCache(bundle(), path.join(readonlyRoot, "v1-abc"))).rejects.toThrow(/EACCES/);
        } finally {
            chmodSync(readonlyRoot, 0o700);
        }
    });

    it("битый бандл с traversal-путём отвергается, лок снимается", async () => {
        const target = path.join(root, "v1-abc");
        // Собираем заголовок руками: packBundle такой путь не пропустит.
        const evil = packBundle([{ virtualPath: "ok.txt", data: Buffer.from("x") }]);
        const patched = Buffer.from(evil);
        const json = patched.toString(
            "utf8",
            12,
            12 + new DataView(patched.buffer, patched.byteOffset + 8, 4).getUint32(0, true),
        );
        const evilJson = json.replace("ok.txt", "../evi");
        expect(evilJson.length).toBe(json.length); // длина заголовка не меняется
        patched.write(evilJson, 12, "utf8");

        await expect(extractBundleToCache(patched, target)).rejects.toThrow(/Invalid segment/);
        expect(existsSync(`${target}.lock`)).toBe(false);
    });

    it.skipIf(process.platform === "win32")("executable: отмеченные файлы исполняемы, остальные — нет", async () => {
        const target = path.join(root, "v1-abc");
        await extractBundleToCache(bundle(), target, { executable: (p) => p.endsWith("cli.mjs") });

        expect(statSync(path.join(target, "server/lib/cli.mjs")).mode & 0o111).not.toBe(0);
        expect(statSync(path.join(target, "node_modules/typescript/lib/tsserver.js")).mode & 0o111).toBe(0);
    });
});

describe("extractBundleToCacheSync", () => {
    let root: string;

    const bundle = () => packBundle([{ virtualPath: "bin/rg", data: Buffer.from("#!/bin/sh\necho rg") }]);

    beforeEach(() => {
        root = mkdtempSync(path.join(tmpdir(), "diode-extract-sync-"));
    });

    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    it("распаковывает синхронно, второй вызов — no-op", () => {
        const target = path.join(root, "v1-abc");
        extractBundleToCacheSync(bundle(), target, { executable: () => true });

        expect(readFileSync(path.join(target, "bin/rg"), "utf8")).toBe("#!/bin/sh\necho rg");
        expect(existsSync(`${target}.lock`)).toBe(false);
        writeFileSync(path.join(target, "bin/rg"), "edited after unpack");
        extractBundleToCacheSync(bundle(), target);
        expect(readFileSync(path.join(target, "bin/rg"), "utf8")).toBe("edited after unpack");
    });

    it("чужой лок без публикации — таймаут с подсказкой про stale lock", () => {
        const target = path.join(root, "v1-abc");
        mkdirSync(`${target}.lock`, { recursive: true });

        expect(() => {
            extractBundleToCacheSync(bundle(), target, { waitTimeoutMs: 60, pollIntervalMs: 10 });
        }).toThrow(/stale lock/);
    });

    it("чужой лок: ждём, пока другой процесс опубликует каталог", () => {
        const target = path.join(root, "v1-abc");
        mkdirSync(`${target}.lock`, { recursive: true });
        // Синхронное ожидание блокирует поток — «владельца» играет отдельный процесс.
        const script = `setTimeout(() => {
            const fs = require("node:fs");
            fs.mkdirSync(${JSON.stringify(target)}, { recursive: true });
            fs.writeFileSync(${JSON.stringify(path.join(target, READY_MARKER))}, "");
        }, 100);`;
        const peer = spawn(process.execPath, ["-e", script], { stdio: "ignore" });
        try {
            extractBundleToCacheSync(bundle(), target); // дефолты: таймаут 30 с, опрос 100 мс
            expect(existsSync(path.join(target, READY_MARKER))).toBe(true);
            // Распаковывал «владелец»-сосед, а не мы.
            expect(existsSync(path.join(target, "bin/rg"))).toBe(false);
        } finally {
            peer.kill();
        }
    });

    it("чужой лок, но каталог уже опубликован — сразу готово", () => {
        const target = path.join(root, "v1-abc");
        mkdirSync(target, { recursive: true });
        writeFileSync(path.join(target, READY_MARKER), "");
        mkdirSync(`${target}.lock`);

        expect(() => {
            extractBundleToCacheSync(bundle(), target, { waitTimeoutMs: 60 });
        }).not.toThrow();
    });
});
